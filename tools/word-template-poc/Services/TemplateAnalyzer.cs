using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Hakurou.WordTemplatePoc.Models;
using OfficeIMO.Word;

namespace Hakurou.WordTemplatePoc.Services;

public static class TemplateAnalyzer
{
    public static TemplateInspection Inspect(string templatePath)
    {
        var absolutePath = Path.GetFullPath(templatePath);
        var logs = new List<string> { $"[Template] Loaded {absolutePath}" };
        var officeImoSectionCount = 0;

        // This load is deliberately read-only from the PoC's point of view. It
        // validates that OfficeIMO can project the template before Open XML does
        // the preservation-sensitive package inspection below.
        using (var officeImoDocument = WordDocument.Load(absolutePath))
        {
            officeImoSectionCount = officeImoDocument.Sections.Count;
            logs.Add($"[OfficeIMO] Loaded template; projected sections: {officeImoSectionCount}");
        }

        using var document = WordprocessingDocument.Open(absolutePath, false);
        var mainPart = document.MainDocumentPart
            ?? throw new InvalidDataException("The DOCX has no MainDocumentPart.");
        var mainDocument = mainPart.Document
            ?? throw new InvalidDataException("The DOCX has no main document XML.");
        var body = mainDocument.Body
            ?? throw new InvalidDataException("The DOCX main document has no body.");

        var sections = ReadSections(body);
        var styles = mainPart.StyleDefinitionsPart?.Styles?
            .Elements<Style>()
            .Select(style => new StyleInfo(
                style.StyleId?.Value ?? string.Empty,
                style.StyleName?.Val?.Value,
                style.Type?.InnerText))
            .OrderBy(style => style.Id, StringComparer.Ordinal)
            .ToArray() ?? [];
        var bookmarks = mainDocument
            .Descendants<BookmarkStart>()
            .Where(bookmark => !string.IsNullOrWhiteSpace(bookmark.Name?.Value))
            .Select(bookmark => new BookmarkInfo(bookmark.Name!.Value!, bookmark.Id?.Value))
            .OrderBy(bookmark => bookmark.Name, StringComparer.Ordinal)
            .ToArray();
        var controls = mainDocument
            .Descendants<SdtElement>()
            .Select(control => new ContentControlInfo(
                control.SdtProperties?.GetFirstChild<Tag>()?.Val?.Value,
                control.SdtProperties?.GetFirstChild<SdtAlias>()?.Val?.Value,
                control.GetType().Name))
            .ToArray();
        var anchors = TemplateAnchors.Inspect(mainPart);
        var headers = mainPart.HeaderParts
            .Select(part => new HeaderFooterInfo(part.Uri.OriginalString, part.ContentType))
            .OrderBy(part => part.PartUri, StringComparer.Ordinal)
            .ToArray();
        var footers = mainPart.FooterParts
            .Select(part => new HeaderFooterInfo(part.Uri.OriginalString, part.ContentType))
            .OrderBy(part => part.PartUri, StringComparer.Ordinal)
            .ToArray();

        foreach (var section in sections)
            logs.Add($"[Template] Section {section.Index + 1} columns: {section.Columns}; break: {section.BreakType}");
        logs.Add($"[Template] Styles: {styles.Length}; bookmarks: {bookmarks.Length}; content controls: {controls.Length}; anchors: {anchors.Count}");
        logs.Add($"[Template] Headers: {headers.Length}; footers: {footers.Length}");

        return new TemplateInspection(absolutePath, officeImoSectionCount, sections, styles, bookmarks, controls, anchors, headers, footers, logs);
    }

    private static IReadOnlyList<SectionInfo> ReadSections(Body body)
    {
        var properties = body
            .Descendants<Paragraph>()
            .Select(paragraph => paragraph.ParagraphProperties?.SectionProperties)
            .Where(section => section is not null)
            .Cast<SectionProperties>()
            .ToList();
        properties.AddRange(body.Elements<SectionProperties>());

        return properties.Select((section, index) =>
        {
            var pageSize = section.GetFirstChild<PageSize>();
            var margins = section.GetFirstChild<PageMargin>();
            var columns = section.GetFirstChild<Columns>();
            return new SectionInfo(
                index,
                section.GetFirstChild<SectionType>()?.Val?.InnerText ?? "nextPage",
                columns?.ColumnCount?.Value ?? (short)1,
                ToInt(pageSize?.Width),
                ToInt(pageSize?.Height),
                new PageMarginsInfo(ToInt(margins?.Top), ToInt(margins?.Bottom), ToInt(margins?.Left), ToInt(margins?.Right), ToInt(margins?.Gutter)),
                ToInt(section.GetFirstChild<PageMargin>()?.Header),
                ToInt(section.GetFirstChild<PageMargin>()?.Footer));
        }).ToArray();
    }

    private static int? ToInt(Int32Value? value) => value?.Value;
    private static int? ToInt(UInt32Value? value) => value is null ? null : checked((int)value.Value);
}
