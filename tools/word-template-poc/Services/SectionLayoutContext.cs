using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Wordprocessing;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Resolves the page and column geometry that applies at an insertion anchor.
/// A section's <c>w:sectPr</c> terminates that section, so an anchor belongs to
/// the first section boundary at or after its containing top-level body item.
/// </summary>
public sealed record SectionLayoutContext(
    int SectionIndex,
    int PageContentWidthTwips,
    IReadOnlyList<int> ColumnWidthsTwips,
    IReadOnlyList<int> ColumnSpacesTwips,
    bool UsesExplicitColumnWidths)
{
    public const long EmusPerTwip = 635;
    public int EffectiveColumnWidthTwips => ColumnWidthsTwips.Count == 0
        ? PageContentWidthTwips
        // A flowing body can move into any unequal column. Using the narrowest
        // one is conservative and never lets an inline object cross a column.
        : ColumnWidthsTwips.Min();
    public long EffectiveColumnWidthEmus => checked((long)EffectiveColumnWidthTwips * EmusPerTwip);
}

public static class SectionLayoutResolver
{
    private const string WordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private const int DefaultPageWidthTwips = 12240;
    private const int DefaultLeftRightMarginTwips = 1800;

    public static SectionLayoutContext Resolve(Body body, OpenXmlElement anchor)
    {
        var topLevel = FindTopLevelBodyChild(body, anchor)
            ?? throw new InvalidDataException("The insertion anchor is not contained by the document body.");
        var children = body.ChildElements.ToArray();
        var anchorIndex = Array.IndexOf(children, topLevel);
        if (anchorIndex < 0) throw new InvalidDataException("The insertion anchor has no body position.");

        var boundaries = ReadBoundaries(body, children);
        var section = boundaries.FirstOrDefault(boundary => boundary.EndIndex >= anchorIndex)
            ?? throw new InvalidDataException("The document body has no terminal section properties.");
        return Create(section.Index, section.Properties);
    }

    public static IReadOnlyList<SectionLayoutContext> ReadAll(Body body)
    {
        var children = body.ChildElements.ToArray();
        return ReadBoundaries(body, children)
            .Select(boundary => Create(boundary.Index, boundary.Properties))
            .ToArray();
    }

    private static IEnumerable<SectionBoundary> ReadBoundaries(Body body, IReadOnlyList<OpenXmlElement> children)
    {
        var index = 0;
        for (var childIndex = 0; childIndex < children.Count; childIndex++)
        {
            var section = children[childIndex] switch
            {
                Paragraph paragraph => paragraph.ParagraphProperties?.SectionProperties,
                _ => null,
            };
            if (section is not null) yield return new SectionBoundary(index++, childIndex, section);
        }
        foreach (var section in body.Elements<SectionProperties>())
            yield return new SectionBoundary(index++, children.Count - 1, section);
    }

    private static OpenXmlElement? FindTopLevelBodyChild(Body body, OpenXmlElement anchor)
    {
        for (OpenXmlElement? current = anchor; current is not null && current != body; current = current.Parent)
            if (current.Parent == body) return current;
        return null;
    }

    private static SectionLayoutContext Create(int index, SectionProperties properties)
    {
        var pageSize = properties.GetFirstChild<PageSize>();
        var margins = properties.GetFirstChild<PageMargin>();
        var pageWidth = ReadTwips(pageSize, "w") ?? DefaultPageWidthTwips;
        var left = ReadTwips(margins, "left") ?? DefaultLeftRightMarginTwips;
        var right = ReadTwips(margins, "right") ?? DefaultLeftRightMarginTwips;
        var gutter = ReadTwips(margins, "gutter") ?? 0;
        var contentWidth = Math.Max(1, pageWidth - left - right - gutter);
        var columns = properties.GetFirstChild<Columns>();
        var equalCount = Math.Max(1, (int)(columns?.ColumnCount?.Value ?? 1));
        var explicitColumns = columns?.Elements<Column>().ToArray() ?? [];
        var usesExplicit = explicitColumns.Length > 0 && explicitColumns.Any(column => ReadTwips(column, "w") is not null);
        var widths = new List<int>();
        var spaces = new List<int>();

        if (usesExplicit)
        {
            foreach (var column in explicitColumns)
            {
                var width = ReadTwips(column, "w");
                if (width is not null) widths.Add(width.Value);
                var space = ReadTwips(column, "space");
                if (space is not null) spaces.Add(space.Value);
            }
            // If a malformed partial explicit definition appears, fill the
            // rest conservatively rather than treating the whole page as one
            // column.
            while (widths.Count < equalCount) widths.Add(Math.Max(1, contentWidth / equalCount));
        }
        else
        {
            var space = ReadTwips(columns, "space") ?? 0;
            var width = Math.Max(1, (contentWidth - (equalCount - 1) * space) / equalCount);
            for (var i = 0; i < equalCount; i++) widths.Add(width);
            for (var i = 0; i < Math.Max(0, equalCount - 1); i++) spaces.Add(space);
        }

        return new SectionLayoutContext(index, contentWidth, widths, spaces, usesExplicit);
    }

    private static int? ReadTwips(OpenXmlElement? element, string localName)
    {
        var value = element?.GetAttributes()
            .FirstOrDefault(attribute => attribute.NamespaceUri == WordNamespace && attribute.LocalName == localName).Value;
        return int.TryParse(value, out var result) ? result : null;
    }

    private sealed record SectionBoundary(int Index, int EndIndex, SectionProperties Properties);
}
