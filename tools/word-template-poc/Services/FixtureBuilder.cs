using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using System.Text;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Developer-only instrumentation for a third-party template that does not
/// expose Hakurou mapping targets. It starts from a copied template and adds
/// three tagged content controls, placing the body control immediately before
/// the paragraph that terminates the first multi-column section. The source
/// template is never changed.
/// </summary>
public static class FixtureBuilder
{
    public static void CreateInstrumentedCopy(string sourcePath, string outputPath)
        => CreateInstrumentedCopy(sourcePath, outputPath, useBookmarksForTextSlots: false);

    public static void CreateBookmarkInstrumentedCopy(string sourcePath, string outputPath)
        => CreateInstrumentedCopy(sourcePath, outputPath, useBookmarksForTextSlots: true);

    /// <summary>
    /// Copies a sample-filled template and wraps explicitly approved, top-level
    /// body-element ranges in Hakurou mapping controls. This deliberately does
    /// not infer ranges from text or styles: the caller must inspect the source
    /// document and provide its exact top-level element boundaries.
    /// </summary>
    public static void CreateExplicitRangeMappedCopy(string sourcePath, string outputPath, ExplicitRangeMapping mapping)
    {
        var source = Path.GetFullPath(sourcePath);
        var destination = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? throw new InvalidOperationException("Output path has no parent directory."));
        File.Copy(source, destination, true);

        using var document = WordprocessingDocument.Open(destination, true);
        var body = document.MainDocumentPart?.Document?.Body
            ?? throw new InvalidDataException("The template has no main document body.");
        EnsureNoHakurouTargets(body);
        var elements = body.ChildElements
            .Where(element => element is not SectionProperties)
            .ToArray();

        ValidateExplicitMapping(elements, mapping);
        WrapRange(elements, new DirectBodyRange(mapping.BodyStart, elements.Length - 1), "HAKUROU_BODY", "Body");
        WrapRange(elements, new DirectBodyRange(mapping.AbstractStart, mapping.AbstractEnd), "HAKUROU_ABSTRACT", "Abstract");
        WrapRange(elements, new DirectBodyRange(mapping.TitleStart, mapping.TitleEnd), "HAKUROU_TITLE", "Title");
        document.MainDocumentPart!.Document!.Save();
    }

    /// <summary>
    /// Maps discrete title, abstract, and body sample ranges while clearing
    /// specified residual sample ranges. Cleared paragraphs retain cloned
    /// paragraph properties so continuous section boundaries remain intact.
    /// </summary>
    public static void CreateSectionSafeMappedCopy(string sourcePath, string outputPath, SectionSafeRangeMapping mapping)
    {
        var source = Path.GetFullPath(sourcePath);
        var destination = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? throw new InvalidOperationException("Output path has no parent directory."));
        File.Copy(source, destination, true);

        using var document = WordprocessingDocument.Open(destination, true);
        var body = document.MainDocumentPart?.Document?.Body
            ?? throw new InvalidDataException("The template has no main document body.");
        EnsureNoHakurouTargets(body);
        var elements = body.ChildElements
            .Where(element => element is not SectionProperties)
            .ToArray();
        ValidateSectionSafeMapping(elements, mapping);

        foreach (var range in mapping.ClearRanges.OrderByDescending(range => range.Start))
            ClearRange(elements, range);
        WrapRange(elements, mapping.Body, "HAKUROU_BODY", "Body");
        WrapRange(elements, mapping.Abstract, "HAKUROU_ABSTRACT", "Abstract");
        WrapRange(elements, mapping.Title, "HAKUROU_TITLE", "Title");
        document.MainDocumentPart!.Document!.Save();
    }

    private static void CreateInstrumentedCopy(string sourcePath, string outputPath, bool useBookmarksForTextSlots)
    {
        var source = Path.GetFullPath(sourcePath);
        var destination = Path.GetFullPath(outputPath);
        Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? throw new InvalidOperationException("Output path has no parent directory."));
        File.Copy(source, destination, true);

        using var document = WordprocessingDocument.Open(destination, true);
        var body = document.MainDocumentPart?.Document?.Body
            ?? throw new InvalidDataException("The template has no main document body.");
        if (useBookmarksForTextSlots)
        {
            body.PrependChild(CreateBookmarkParagraph("HAKUROU_ABSTRACT", 9002, "Abstract", "Template abstract placeholder"));
            body.PrependChild(CreateBookmarkParagraph("HAKUROU_TITLE", 9001, "papertitle", "Template title placeholder"));
        }
        else
        {
            body.PrependChild(CreateBlockControl("HAKUROU_ABSTRACT", "Abstract", "Abstract", "Template abstract placeholder"));
            body.PrependChild(CreateBlockControl("HAKUROU_TITLE", "Title", "papertitle", "Template title placeholder"));
        }

        var multiColumnBoundary = body.Descendants<Paragraph>()
            .FirstOrDefault(paragraph => (paragraph.ParagraphProperties?.SectionProperties?.GetFirstChild<Columns>()?.ColumnCount?.Value ?? 1) == 2)
            ?? throw new InvalidDataException("The template does not contain a two-column section boundary.");
        // In WordprocessingML a paragraph's sectPr closes the section before
        // it; inserting after it would move the body into the following (often
        // single-column) section.
        multiColumnBoundary.InsertBeforeSelf(CreateBlockControl("HAKUROU_BODY", "Body", "a", "Template body placeholder"));
        document.MainDocumentPart!.Document!.Save();
    }

    private static SdtBlock CreateBlockControl(string tag, string title, string styleId, string placeholder)
    {
        return new SdtBlock(
            new SdtProperties(
                new SdtAlias { Val = title },
                new Tag { Val = tag },
                new SdtId { Val = Random.Shared.Next(1, int.MaxValue) }),
            new SdtContentBlock(
                new Paragraph(
                    new ParagraphProperties(new ParagraphStyleId { Val = styleId }),
                    new Run(new Text(placeholder)))));
    }

    private static void ValidateExplicitMapping(IReadOnlyList<OpenXmlElement> elements, ExplicitRangeMapping mapping)
    {
        if (elements.Count == 0) throw new InvalidDataException("The template body has no top-level content to map.");
        if (mapping.TitleStart != 0 || mapping.TitleEnd < mapping.TitleStart ||
            mapping.AbstractStart != mapping.TitleEnd + 1 || mapping.AbstractEnd < mapping.AbstractStart ||
            mapping.BodyStart != mapping.AbstractEnd + 1 || mapping.BodyStart >= elements.Count)
            throw new InvalidDataException("Explicit mapping ranges must be contiguous from the first body element through the final body element, and must leave a body element to replace.");
        if (mapping.TitleEnd >= elements.Count || mapping.AbstractEnd >= elements.Count)
            throw new InvalidDataException("An explicit mapping range exceeds the template body's top-level content.");
    }

    private static void EnsureNoHakurouTargets(Body body)
    {
        var existingTargets = body.Descendants<Tag>()
            .Select(tag => tag.Val?.Value)
            .Concat(body.Descendants<BookmarkStart>().Select(bookmark => bookmark.Name?.Value))
            .Where(name => name is "HAKUROU_TITLE" or "HAKUROU_ABSTRACT" or "HAKUROU_BODY")
            .ToArray();
        if (existingTargets.Length > 0)
            throw new InvalidDataException($"The template already contains Hakurou mapping target(s): {string.Join(", ", existingTargets)}. Render against its existing anchors instead of range mapping it again.");
    }

    private static void ValidateSectionSafeMapping(IReadOnlyList<OpenXmlElement> elements, SectionSafeRangeMapping mapping)
    {
        var ranges = new[] { mapping.Title, mapping.Abstract, mapping.Body }
            .Concat(mapping.ClearRanges)
            .ToArray();
        foreach (var range in ranges)
        {
            if (range.Start < 0 || range.End < range.Start || range.End >= elements.Count)
                throw new InvalidDataException("A mapping range exceeds the template body's top-level content.");
        }
        for (var left = 0; left < ranges.Length; left++)
        for (var right = left + 1; right < ranges.Length; right++)
            if (ranges[left].Start <= ranges[right].End && ranges[right].Start <= ranges[left].End)
                throw new InvalidDataException("Title, abstract, body, and clear ranges must not overlap.");

        foreach (var range in new[] { mapping.Title, mapping.Abstract, mapping.Body })
        {
            if (Enumerable.Range(range.Start, range.End - range.Start + 1)
                .Any(index => elements[index] is Paragraph paragraph && paragraph.ParagraphProperties?.SectionProperties is not null))
                throw new InvalidDataException("A mapped replacement range contains a section boundary. Keep that paragraph in a clear range so its continuous section settings are preserved.");
        }
    }

    private static void ClearRange(IReadOnlyList<OpenXmlElement> elements, DirectBodyRange range)
    {
        for (var index = range.Start; index <= range.End; index++)
        {
            if (elements[index] is Paragraph paragraph)
            {
                var properties = paragraph.ParagraphProperties?.CloneNode(true) as ParagraphProperties;
                paragraph.RemoveAllChildren();
                if (properties is not null) paragraph.AppendChild(properties);
            }
            else
            {
                elements[index].Remove();
            }
        }
    }

    private static void WrapRange(IReadOnlyList<OpenXmlElement> elements, DirectBodyRange range, string tag, string title)
    {
        var first = elements[range.Start];
        var content = new SdtContentBlock();
        var control = new SdtBlock(
            new SdtProperties(
                new SdtAlias { Val = title },
                new Tag { Val = tag },
                new SdtId { Val = Random.Shared.Next(1, int.MaxValue) }),
            content);
        first.InsertBeforeSelf(control);

        for (var index = range.Start; index <= range.End; index++)
        {
            var element = elements[index];
            element.Remove();
            content.AppendChild(element);
        }
    }

    private static Paragraph CreateBookmarkParagraph(string name, int id, string styleId, string placeholder)
    {
        var bookmarkId = id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        return new Paragraph(
            new ParagraphProperties(new ParagraphStyleId { Val = styleId }),
            new BookmarkStart { Name = name, Id = bookmarkId },
            new Run(new Text(placeholder)),
            new BookmarkEnd { Id = bookmarkId });
    }

    /// <summary>
    /// Creates the deliberately plain regression corpus. These are test-only
    /// documents; their role is to isolate OOXML shapes, not to look polished.
    /// </summary>
    public static IReadOnlyList<RegressionTemplate> CreateRegressionCorpus(string directory)
    {
        Directory.CreateDirectory(directory);
        var corpus = new[]
        {
            new RegressionTemplate("A-single-column", false, false, false, false, false),
            new RegressionTemplate("B-continuous-columns", true, false, false, false, false),
            new RegressionTemplate("C-sections-headers-footers", true, true, false, false, false),
            new RegressionTemplate("D-existing-numbering", false, false, true, false, false),
            new RegressionTemplate("E-existing-image-relationship", false, false, false, true, false),
            new RegressionTemplate("F-content-control", false, false, false, false, false),
            new RegressionTemplate("G-bookmark", false, false, false, false, true),
        };
        foreach (var item in corpus)
            CreateMinimalTemplate(Path.Combine(directory, $"{item.Name}.docx"), item);
        return corpus;
    }

    public static void WriteRegressionImages(string directory)
    {
        Directory.CreateDirectory(directory);
        var bytes = Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLefwAAAABJRU5ErkJggg==");
        foreach (var name in new[] { "fixture-a.png", "fixture-b.png", "fixture-c.png" })
            File.WriteAllBytes(Path.Combine(directory, name), bytes);
    }

    public static IReadOnlyDictionary<string, string> CreateAnchorProbeTemplates(string directory)
    {
        Directory.CreateDirectory(directory);
        var inline = Path.Combine(directory, "inline-body.docx");
        var duplicate = Path.Combine(directory, "duplicate-tag.docx");
        var malformed = Path.Combine(directory, "malformed-bookmark.docx");
        CreateMinimalTemplate(inline, new RegressionTemplate("inline", false, false, false, false, false));
        CreateMinimalTemplate(duplicate, new RegressionTemplate("duplicate", false, false, false, false, false));
        CreateMinimalTemplate(malformed, new RegressionTemplate("malformed", false, false, false, false, true));

        using (var document = WordprocessingDocument.Open(inline, true))
        {
            var body = document.MainDocumentPart!.Document!.Body!;
            var existing = body.Descendants<SdtBlock>().Single(block => block.SdtProperties?.GetFirstChild<Tag>()?.Val?.Value == "HAKUROU_BODY");
            existing.Remove();
            var inlineTarget = new Paragraph(new SdtRun(
                new SdtProperties(new Tag { Val = "HAKUROU_BODY" }, new SdtId { Val = 2001 }),
                new SdtContentRun(new Run(new Text("inline body placeholder")))));
            body.InsertBefore(inlineTarget, body.Elements<SectionProperties>().Single());
            document.MainDocumentPart.Document.Save();
        }
        using (var document = WordprocessingDocument.Open(duplicate, true))
        {
            var body = document.MainDocumentPart!.Document!.Body!;
            body.InsertBefore(CreateBlockControl("HAKUROU_TITLE", "Duplicate title", "Title", "duplicate"), body.Elements<SectionProperties>().Single());
            document.MainDocumentPart.Document.Save();
        }
        using (var document = WordprocessingDocument.Open(malformed, true))
        {
            var body = document.MainDocumentPart!.Document!.Body!;
            body.Descendants<BookmarkEnd>().Single(end => end.Id?.Value == "101").Remove();
            document.MainDocumentPart.Document.Save();
        }
        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["inline-body"] = inline,
            ["duplicate-tag"] = duplicate,
            ["malformed-bookmark"] = malformed,
        };
    }

    /// <summary>Small, purpose-built fixtures for Stage 3 layout and anchor probes.</summary>
    public static IReadOnlyDictionary<string, string> CreateStage3ProbeTemplates(string directory)
    {
        Directory.CreateDirectory(directory);
        var twoColumns = Path.Combine(directory, "two-columns.docx");
        var threeColumns = Path.Combine(directory, "three-columns.docx");
        var unequalColumns = Path.Combine(directory, "unequal-columns.docx");
        var inlineText = Path.Combine(directory, "inline-text-bookmark.docx");
        var nonDedicatedBody = Path.Combine(directory, "non-dedicated-body-bookmark.docx");
        var sectionHeader = Path.Combine(directory, "section-header.docx");
        CreateMinimalTemplate(twoColumns, new RegressionTemplate("two", true, false, false, false, false));
        CreateMinimalTemplate(threeColumns, new RegressionTemplate("three", false, false, false, false, false));
        CreateMinimalTemplate(unequalColumns, new RegressionTemplate("unequal", false, false, false, false, false));
        CreateMinimalTemplate(inlineText, new RegressionTemplate("inlineText", false, false, false, false, true));
        CreateMinimalTemplate(nonDedicatedBody, new RegressionTemplate("nonDedicated", false, false, false, false, true));
        CreateMinimalTemplate(sectionHeader, new RegressionTemplate("sectionHeader", true, true, false, false, false));

        ConfigureColumns(threeColumns, 3, 360, null);
        ConfigureColumns(unequalColumns, 3, 0, new[] { (1600, 200), (2800, 200), (3400, 0) });
        ReplaceBookmarkParagraphWithInlineText(inlineText, "HAKUROU_TITLE", 101, "Prefix ", "[BOOKMARK]", " Suffix", "Title");
        ReplaceBookmarkParagraphWithInlineText(inlineText, "HAKUROU_ABSTRACT", 102, "Abstract prefix ", "[BOOKMARK]", " abstract suffix", "Normal");
        MakeBodyBookmarkNonDedicated(nonDedicatedBody);

        return new Dictionary<string, string>(StringComparer.Ordinal)
        {
            ["two-columns"] = twoColumns,
            ["three-columns"] = threeColumns,
            ["unequal-columns"] = unequalColumns,
            ["inline-text-bookmark"] = inlineText,
            ["non-dedicated-body-bookmark"] = nonDedicatedBody,
            ["section-header"] = sectionHeader,
        };
    }

    private static void ConfigureColumns(string path, short count, int space, IReadOnlyList<(int Width, int Space)>? explicitColumns)
    {
        using var document = WordprocessingDocument.Open(path, true);
        var section = document.MainDocumentPart!.Document!.Body!.Elements<SectionProperties>().Single();
        var columns = section.GetFirstChild<Columns>() ?? section.AppendChild(new Columns());
        columns.ColumnCount = count;
        columns.Space = space.ToString(System.Globalization.CultureInfo.InvariantCulture);
        columns.RemoveAllChildren<Column>();
        if (explicitColumns is not null)
        {
            foreach (var (width, columnSpace) in explicitColumns)
            {
                var column = new Column();
                column.SetAttribute(new OpenXmlAttribute("w", "w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main", width.ToString(System.Globalization.CultureInfo.InvariantCulture)));
                if (columnSpace > 0)
                    column.SetAttribute(new OpenXmlAttribute("w", "space", "http://schemas.openxmlformats.org/wordprocessingml/2006/main", columnSpace.ToString(System.Globalization.CultureInfo.InvariantCulture)));
                columns.AppendChild(column);
            }
        }
        document.MainDocumentPart.Document.Save();
    }

    private static void ReplaceBookmarkParagraphWithInlineText(string path, string name, int id, string prefix, string placeholder, string suffix, string styleId)
    {
        using var document = WordprocessingDocument.Open(path, true);
        var body = document.MainDocumentPart!.Document!.Body!;
        var old = body.Descendants<BookmarkStart>().Single(bookmark => bookmark.Name?.Value == name).Ancestors<Paragraph>().Single();
        var idText = id.ToString(System.Globalization.CultureInfo.InvariantCulture);
        old.InsertAfterSelf(new Paragraph(
            new ParagraphProperties(new ParagraphStyleId { Val = styleId }),
            new Run(new Text(prefix)),
            new BookmarkStart { Name = name, Id = idText },
            new Run(new Text(placeholder)),
            new BookmarkEnd { Id = idText },
            new Run(new Text(suffix))));
        old.Remove();
        document.MainDocumentPart.Document.Save();
    }

    private static void MakeBodyBookmarkNonDedicated(string path)
    {
        using var document = WordprocessingDocument.Open(path, true);
        var body = document.MainDocumentPart!.Document!.Body!;
        var control = body.Descendants<SdtBlock>().Single(block => block.SdtProperties?.GetFirstChild<Tag>()?.Val?.Value == "HAKUROU_BODY");
        control.InsertAfterSelf(new Paragraph(
            new ParagraphProperties(new ParagraphStyleId { Val = "Normal" }),
            new Run(new Text("Prefix ")),
            new BookmarkStart { Name = "HAKUROU_BODY", Id = "333" },
            new Run(new Text("[BOOKMARK]")),
            new BookmarkEnd { Id = "333" },
            new Run(new Text(" Suffix"))));
        control.Remove();
        document.MainDocumentPart.Document.Save();
    }

    private static void CreateMinimalTemplate(string path, RegressionTemplate fixture)
    {
        using var document = WordprocessingDocument.Create(path, WordprocessingDocumentType.Document);
        var main = document.AddMainDocumentPart();
        main.Document = new Document(new Body());
        AddRegressionStyles(main);
        var body = main.Document.Body!;

        if (fixture.UseBookmarks)
        {
            body.Append(CreateBookmarkParagraph("HAKUROU_TITLE", 101, "Title", "Title placeholder"));
            body.Append(CreateBookmarkParagraph("HAKUROU_ABSTRACT", 102, "Normal", "Abstract placeholder"));
        }
        else
        {
            body.Append(CreateBlockControl("HAKUROU_TITLE", "Title", "Title", "Title placeholder"));
            body.Append(CreateBlockControl("HAKUROU_ABSTRACT", "Abstract", "Normal", "Abstract placeholder"));
        }

        if (fixture.MultipleSections)
        {
            var firstSection = CreateSectionProperties(1);
            if (fixture.HeadersAndFooters) AddHeaderFooterReferences(main, firstSection, "First section");
            body.Append(new Paragraph(new ParagraphProperties(firstSection)));
        }
        body.Append(CreateBlockControl("HAKUROU_BODY", "Body", "Normal", "Body placeholder"));
        var finalSection = CreateSectionProperties(fixture.MultipleSections ? (short)2 : (short)1);
        if (fixture.HeadersAndFooters) AddHeaderFooterReferences(main, finalSection, "Second section");
        body.Append(finalSection);

        if (fixture.ExistingNumbering) AddExistingNumbering(main);
        if (fixture.ExistingImageRelationship) AddExistingImageRelationship(main);
        main.Document.Save();
    }

    private static void AddRegressionStyles(MainDocumentPart main)
    {
        var styles = main.AddNewPart<StyleDefinitionsPart>();
        styles.Styles = new Styles(
            new Style(new Name { Val = "Normal" }) { Type = StyleValues.Paragraph, StyleId = "Normal", Default = true },
            new Style(new Name { Val = "Heading 1" }) { Type = StyleValues.Paragraph, StyleId = "Heading1", BasedOn = new BasedOn { Val = "Normal" } },
            new Style(new Name { Val = "Heading 2" }) { Type = StyleValues.Paragraph, StyleId = "Heading2", BasedOn = new BasedOn { Val = "Normal" } },
            new Style(new Name { Val = "Title" }) { Type = StyleValues.Paragraph, StyleId = "Title", BasedOn = new BasedOn { Val = "Normal" } },
            new Style(new Name { Val = "Normal Table" }) { Type = StyleValues.Table, StyleId = "Table", Default = true },
            new Style(new Name { Val = "Default Paragraph Font" }) { Type = StyleValues.Character, StyleId = "DefaultParagraphFont", Default = true });
        styles.Styles.Save();
    }

    private static SectionProperties CreateSectionProperties(short columns) => new(
        new SectionType { Val = SectionMarkValues.Continuous },
        new PageSize { Width = 12240, Height = 15840 },
        new PageMargin { Top = 1440, Bottom = 1440, Left = 1440, Right = 1440, Gutter = 0 },
        new Columns { ColumnCount = columns });

    private static void AddHeaderFooterReferences(MainDocumentPart main, SectionProperties section, string text)
    {
        var header = main.AddNewPart<HeaderPart>();
        header.Header = new Header(new Paragraph(new Run(new Text($"Header {text}"))));
        header.Header.Save();
        var footer = main.AddNewPart<FooterPart>();
        footer.Footer = new Footer(new Paragraph(new Run(new Text($"Footer {text}"))));
        footer.Footer.Save();
        section.PrependChild(new HeaderReference { Type = HeaderFooterValues.Default, Id = main.GetIdOfPart(header) });
        section.PrependChild(new FooterReference { Type = HeaderFooterValues.Default, Id = main.GetIdOfPart(footer) });
    }

    private static void AddExistingNumbering(MainDocumentPart main)
    {
        var part = main.AddNewPart<NumberingDefinitionsPart>();
        using var stream = part.GetStream(FileMode.Create, FileAccess.Write);
        using var writer = new StreamWriter(stream, new UTF8Encoding(false));
        writer.Write("<w:numbering xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:abstractNum w:abstractNumId=\"7\"><w:multiLevelType w:val=\"singleLevel\"/><w:lvl w:ilvl=\"0\"><w:start w:val=\"1\"/><w:numFmt w:val=\"decimal\"/><w:lvlText w:val=\"%1.\"/></w:lvl></w:abstractNum><w:num w:numId=\"9\"><w:abstractNumId w:val=\"7\"/></w:num></w:numbering>");
    }

    private static void AddExistingImageRelationship(MainDocumentPart main)
    {
        var image = main.AddImagePart(ImagePartType.Png);
        using var stream = image.GetStream(FileMode.Create, FileAccess.Write);
        stream.Write(Convert.FromBase64String("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLefwAAAABJRU5ErkJggg=="));
    }
}

public sealed record RegressionTemplate(
    string Name,
    bool MultipleSections,
    bool HeadersAndFooters,
    bool ExistingNumbering,
    bool ExistingImageRelationship,
    bool UseBookmarks);

public sealed record ExplicitRangeMapping(
    int TitleStart,
    int TitleEnd,
    int AbstractStart,
    int AbstractEnd,
    int BodyStart);

public sealed record DirectBodyRange(int Start, int End);

public sealed record SectionSafeRangeMapping(
    DirectBodyRange Title,
    DirectBodyRange Abstract,
    DirectBodyRange Body,
    IReadOnlyList<DirectBodyRange> ClearRanges);
