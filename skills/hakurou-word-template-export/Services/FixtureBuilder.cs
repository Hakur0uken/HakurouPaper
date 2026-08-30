using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using System.Text;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Test-only instrumentation for a third-party template that does not expose
/// Hakurou mapping targets. It starts from a copied template and adds three
/// tagged content controls, placing the body control after the first boundary
/// leading into a multi-column section. The source template is never changed.
/// </summary>
public static class FixtureBuilder
{
    public static void CreateInstrumentedCopy(string sourcePath, string outputPath)
        => CreateInstrumentedCopy(sourcePath, outputPath, useBookmarksForTextSlots: false);

    public static void CreateBookmarkInstrumentedCopy(string sourcePath, string outputPath)
        => CreateInstrumentedCopy(sourcePath, outputPath, useBookmarksForTextSlots: true);

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
        multiColumnBoundary.InsertAfterSelf(CreateBlockControl("HAKUROU_BODY", "Body", "a", "Template body placeholder"));
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
