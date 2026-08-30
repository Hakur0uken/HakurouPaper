using System.Text.Json;
using System.IO.Compression;
using System.Xml.Linq;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Executable OOXML regression corpus. It is intentionally a CLI-only test
/// harness so the experimental exporter keeps no test fixtures in its runtime
/// path.
/// </summary>
public static class RegressionSuite
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static RegressionSuiteResult Run(
        string pandocPath,
        string fixtureMarkdownPath,
        string outputDirectory,
        bool validateWithWord)
    {
        var root = Path.GetFullPath(outputDirectory);
        Directory.CreateDirectory(root);
        FixtureBuilder.WriteRegressionImages(root);
        var markdown = File.ReadAllText(Path.GetFullPath(fixtureMarkdownPath));
        var cases = new List<RegressionCaseResult>();
        WordApplicationValidationResult? wordValidation = null;

        try
        {
            foreach (var fixture in FixtureBuilder.CreateRegressionCorpus(root))
            {
                var caseDirectory = Path.Combine(root, fixture.Name);
                var firstDirectory = Path.Combine(caseDirectory, "first");
                var secondDirectory = Path.Combine(caseDirectory, "second");
                Directory.CreateDirectory(firstDirectory);
                Directory.CreateDirectory(secondDirectory);
                var templatePath = Path.Combine(root, $"{fixture.Name}.docx");
                var baseline = TemplateAnalyzer.Inspect(templatePath);
                var first = TemplateRenderer.Render(new RenderTemplateRequest(
                    templatePath,
                    Path.Combine(firstDirectory, "output.docx"),
                    markdown,
                    Path.GetFullPath(pandocPath),
                    root));
                EnsurePassed(first, fixture.Name, baseline, requireNumbering: true);
                var second = TemplateRenderer.Render(new RenderTemplateRequest(
                    first.OutputPath ?? throw new InvalidDataException("First output is missing."),
                    Path.Combine(secondDirectory, "output.docx"),
                    markdown,
                    Path.GetFullPath(pandocPath),
                    root));
                EnsurePassed(second, $"{fixture.Name} second insertion", baseline, requireNumbering: true);

                if (validateWithWord && wordValidation is null)
                    wordValidation = WindowsWordValidationService.Validate(
                        second.OutputPath ?? throw new InvalidDataException("Second output is missing."),
                        Path.Combine(secondDirectory, "word-validation-saveas.docx"));
                cases.Add(new RegressionCaseResult(
                    fixture.Name,
                    true,
                    first.ValidationReport,
                    second.ValidationReport,
                    first.Capabilities,
                    null));
            }
            var anchorProbes = FixtureBuilder.CreateAnchorProbeTemplates(Path.Combine(root, "anchor-probes"));
            EnsureAnchorRejected("inline body", anchorProbes["inline-body"], markdown, pandocPath, root, "incompatibleAnchor");
            EnsureAnchorRejected("duplicate tag", anchorProbes["duplicate-tag"], markdown, pandocPath, root, "duplicate tag");
            EnsureAnchorRejected("malformed bookmark", anchorProbes["malformed-bookmark"], markdown, pandocPath, root, "invalid bookmark");
            cases.Add(new RegressionCaseResult("anchor-compatibility-probes", true, null, null, null, null));
            RunStage3Probes(cases, FixtureBuilder.CreateStage3ProbeTemplates(Path.Combine(root, "stage3-probes")), markdown, pandocPath, root);
        }
        catch (Exception exception)
        {
            cases.Add(new RegressionCaseResult("suite", false, null, null, null, exception.Message));
        }

        var succeeded = cases.Count == 15 && cases.All(item => item.Passed)
            && (wordValidation is null || wordValidation.Success);
        var result = new RegressionSuiteResult(succeeded, root, cases, wordValidation);
        File.WriteAllText(Path.Combine(root, "regression-summary.json"), JsonSerializer.Serialize(result, JsonOptions));
        return result;
    }

    private static void EnsurePassed(RenderTemplateResult result, string name, TemplateInspection baseline, bool requireNumbering = false)
    {
        if (!result.Success)
            throw new InvalidDataException($"{name}: export failed: {result.Error ?? string.Join("; ", result.ValidationErrors)}");
        var report = result.ValidationReport
            ?? throw new InvalidDataException($"{name}: validation report is missing.");
        if (!report.Passed) throw new InvalidDataException($"{name}: validation report did not pass.");
        if (report.SectionCount != baseline.Sections.Count || !report.Columns.SequenceEqual(baseline.Sections.Select(section => section.Columns)))
            throw new InvalidDataException($"{name}: section layout changed.");
        if (report.UnexpectedChangedParts.Count > 0)
            throw new InvalidDataException($"{name}: unexpected package changes: {string.Join(", ", report.UnexpectedChangedParts)}");
        var numberingTouched = result.Preservation?.ChangedParts.Concat(result.Preservation.AddedParts)
            .Any(part => string.Equals(part.Path, "word/numbering.xml", StringComparison.OrdinalIgnoreCase)) == true;
        if (requireNumbering && !numberingTouched) throw new InvalidDataException($"{name}: numbering.xml was not merged for the numbered-list fixture.");
    }

    private static void EnsureAnchorRejected(
        string name,
        string templatePath,
        string markdown,
        string pandocPath,
        string workingDirectory,
        string expectedIssue)
    {
        var outputPath = Path.Combine(Path.GetDirectoryName(templatePath)!, $"{name.Replace(' ', '-')}-should-not-exist.docx");
        var result = TemplateRenderer.Render(new RenderTemplateRequest(
            templatePath,
            outputPath,
            markdown,
            Path.GetFullPath(pandocPath),
            workingDirectory));
        var hasExpectedIssue = result.AnchorIssues?.Any(issue => issue.Contains(expectedIssue, StringComparison.Ordinal)) == true;
        if (result.Success || !hasExpectedIssue)
            throw new InvalidDataException($"Anchor probe '{name}' was not rejected as expected ({expectedIssue}).");
        if (File.Exists(outputPath)) throw new InvalidDataException($"Anchor probe '{name}' created an output file despite failed preflight.");
    }

    private static void RunStage3Probes(
        ICollection<RegressionCaseResult> cases,
        IReadOnlyDictionary<string, string> templates,
        string markdown,
        string pandocPath,
        string root)
    {
        var wideImageMarkdown = "# Wide image\n\n## Abstract\n\nWide image layout probe.\n\n## Body\n\n![wide](fixture-a.png){width=12in}";
        var narrowImageMarkdown = "# Narrow image\n\n## Abstract\n\nNarrow image layout probe.\n\n## Body\n\n![narrow](fixture-a.png){width=0.2in}";
        var threeLayout = ReadAnchorLayout(templates["three-columns"]);
        var unequalLayout = ReadAnchorLayout(templates["unequal-columns"]);
        if (threeLayout.ColumnWidthsTwips.Count != 3 || threeLayout.EffectiveColumnWidthTwips != 2880)
            throw new InvalidDataException("Three-column layout did not resolve its actual column width.");
        if (!unequalLayout.UsesExplicitColumnWidths || !unequalLayout.ColumnWidthsTwips.SequenceEqual(new[] { 1600, 2800, 3400 }) || unequalLayout.EffectiveColumnWidthTwips != 1600)
            throw new InvalidDataException("Explicit unequal column widths were not read conservatively.");
        cases.Add(new RegressionCaseResult("layout-context-three-and-unequal-columns", true, null, null, null, null));

        var wideOutput = Path.Combine(root, "stage3-probes", "wide-image-output.docx");
        var wide = TemplateRenderer.Render(new RenderTemplateRequest(templates["two-columns"], wideOutput, wideImageMarkdown, Path.GetFullPath(pandocPath), root));
        EnsurePassed(wide, "wide image", TemplateAnalyzer.Inspect(templates["two-columns"]));
        var twoColumnLayout = ReadAnchorLayout(templates["two-columns"]);
        if (ReadInlineImageWidths(wideOutput).Any(width => width > twoColumnLayout.EffectiveColumnWidthEmus))
            throw new InvalidDataException("A wide inline image exceeds the current column width.");
        var transformWidths = ReadTransformImageWidths(wideOutput);
        if (transformWidths.Count == 0 || transformWidths.Any(width => width > twoColumnLayout.EffectiveColumnWidthEmus))
            throw new InvalidDataException("A wide image transform extent exceeds the current column width.");
        var threeWideOutput = Path.Combine(root, "stage3-probes", "three-column-wide-image-output.docx");
        var threeWide = TemplateRenderer.Render(new RenderTemplateRequest(templates["three-columns"], threeWideOutput, wideImageMarkdown, Path.GetFullPath(pandocPath), root));
        EnsurePassed(threeWide, "three-column wide image", TemplateAnalyzer.Inspect(templates["three-columns"]));
        var threeColumnWidths = ReadInlineImageWidths(threeWideOutput);
        if (threeColumnWidths.Count == 0 || threeColumnWidths.Any(width => width != threeLayout.EffectiveColumnWidthEmus))
            throw new InvalidDataException("A three-column image did not use the three-column width.");
        cases.Add(new RegressionCaseResult("wide-image-fits-current-column", true, wide.ValidationReport, null, wide.Capabilities, null));

        var narrowOutput = Path.Combine(root, "stage3-probes", "narrow-image-output.docx");
        var narrow = TemplateRenderer.Render(new RenderTemplateRequest(templates["three-columns"], narrowOutput, narrowImageMarkdown, Path.GetFullPath(pandocPath), root));
        EnsurePassed(narrow, "narrow image", TemplateAnalyzer.Inspect(templates["three-columns"]));
        if (ReadInlineImageWidths(narrowOutput).Any(width => width > 182880L))
            throw new InvalidDataException("A narrow inline image was upscaled.");
        cases.Add(new RegressionCaseResult("narrow-image-is-not-upscaled", true, narrow.ValidationReport, null, narrow.Capabilities, null));

        var wideTableOutput = Path.Combine(root, "stage3-probes", "wide-table-output.docx");
        var wideTable = TemplateRenderer.Render(new RenderTemplateRequest(templates["three-columns"], wideTableOutput, markdown, Path.GetFullPath(pandocPath), root));
        EnsurePassed(wideTable, "wide table", TemplateAnalyzer.Inspect(templates["three-columns"]));
        if (wideTable.Capabilities?.PotentiallyLossy.Contains("table too wide for current column", StringComparer.Ordinal) != true)
            throw new InvalidDataException("A wide table did not report its current-column layout risk.");
        cases.Add(new RegressionCaseResult("wide-table-layout-warning", true, wideTable.ValidationReport, null, wideTable.Capabilities, null));

        var inlineOutput = Path.Combine(root, "stage3-probes", "inline-bookmark-output.docx");
        var inline = TemplateRenderer.Render(new RenderTemplateRequest(templates["inline-text-bookmark"], inlineOutput, markdown, Path.GetFullPath(pandocPath), root));
        EnsurePassed(inline, "inline bookmark", TemplateAnalyzer.Inspect(templates["inline-text-bookmark"]));
        var titleText = FindBookmarkParagraphText(inlineOutput, "HAKUROU_TITLE");
        if (!titleText.Contains("Prefix ", StringComparison.Ordinal) || !titleText.Contains(" Suffix", StringComparison.Ordinal))
            throw new InvalidDataException("Inline bookmark replacement did not preserve surrounding title text.");
        cases.Add(new RegressionCaseResult("inline-bookmark-preserves-prefix-suffix", true, inline.ValidationReport, null, inline.Capabilities, null));

        EnsureAnchorRejected("non dedicated body bookmark", templates["non-dedicated-body-bookmark"], markdown, pandocPath, root, "incompatibleAnchor");
        EnsureTransactionalFailurePreservesFinal(templates["non-dedicated-body-bookmark"], markdown, pandocPath, root);
        cases.Add(new RegressionCaseResult("body-bookmark-and-transactional-rejection", true, null, null, null, null));

        EnsureRelationshipAndSectionMutationFailures(templates["section-header"], root);
        cases.Add(new RegressionCaseResult("relationship-and-section-snapshot-failures", true, null, null, null, null));
    }

    private static SectionLayoutContext ReadAnchorLayout(string path)
    {
        using var document = WordprocessingDocument.Open(path, false);
        var main = document.MainDocumentPart ?? throw new InvalidDataException("Template has no main part.");
        var body = main.Document?.Body ?? throw new InvalidDataException("Template has no body.");
        var target = TemplateAnchors.Resolve(main, new MappingPlan(), true).Targets["HAKUROU_BODY"];
        return SectionLayoutResolver.Resolve(body, (OpenXmlElement?)target.ContentControl ?? target.Bookmark ?? throw new InvalidDataException("Missing body target."));
    }

    private static IReadOnlyList<long> ReadInlineImageWidths(string path)
    {
        const string drawing = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
        using var archive = ZipFile.OpenRead(path);
        var document = archive.GetEntry("word/document.xml") ?? throw new InvalidDataException("Missing document XML.");
        using var stream = document.Open();
        var xml = XDocument.Load(stream);
        return xml.Descendants(XName.Get("extent", drawing))
            .Select(element => long.TryParse((string?)element.Attribute("cx"), out var width) ? width : 0)
            .Where(width => width > 0).ToArray();
    }

    private static IReadOnlyList<long> ReadTransformImageWidths(string path)
    {
        const string drawing = "http://schemas.openxmlformats.org/drawingml/2006/main";
        using var archive = ZipFile.OpenRead(path);
        var document = archive.GetEntry("word/document.xml") ?? throw new InvalidDataException("Missing document XML.");
        using var stream = document.Open();
        var xml = XDocument.Load(stream);
        return xml.Descendants(XName.Get("xfrm", drawing)).Elements(XName.Get("ext", drawing))
            .Select(element => long.TryParse((string?)element.Attribute("cx"), out var width) ? width : 0)
            .Where(width => width > 0).ToArray();
    }

    private static string FindBookmarkParagraphText(string path, string name)
    {
        using var document = WordprocessingDocument.Open(path, false);
        var bookmark = document.MainDocumentPart?.Document?.Descendants<BookmarkStart>().Single(item => item.Name?.Value == name)
            ?? throw new InvalidDataException($"Bookmark {name} is missing.");
        return bookmark.Ancestors<Paragraph>().Single().InnerText;
    }

    private static void EnsureTransactionalFailurePreservesFinal(string templatePath, string markdown, string pandocPath, string root)
    {
        var output = Path.Combine(root, "stage3-probes", "existing-final.docx");
        var sentinel = System.Text.Encoding.UTF8.GetBytes("pre-existing-final-must-survive");
        File.WriteAllBytes(output, sentinel);
        var result = TemplateRenderer.Render(new RenderTemplateRequest(templatePath, output, markdown, Path.GetFullPath(pandocPath), root));
        if (result.Success || !File.ReadAllBytes(output).SequenceEqual(sentinel))
            throw new InvalidDataException("A failed export overwrote its existing final output.");
    }

    private static void EnsureRelationshipAndSectionMutationFailures(string templatePath, string root)
    {
        var directory = Path.Combine(root, "stage3-probes", "validation-mutations");
        Directory.CreateDirectory(directory);
        var noRelationships = Path.Combine(directory, "no-document-rels.docx");
        File.Copy(templatePath, noRelationships, true);
        using (var document = WordprocessingDocument.Open(noRelationships, true))
        {
            document.MainDocumentPart!.Document!.Body!.PrependChild(new Paragraph(new Hyperlink(new Run(new Text("broken"))) { Id = "rIdMissing" }));
            document.MainDocumentPart.Document.Save();
        }
        using (var archive = ZipFile.Open(noRelationships, ZipArchiveMode.Update))
            archive.GetEntry("word/_rels/document.xml.rels")?.Delete();
        var relationReport = PackageValidationService.Validate(noRelationships, PackageComparer.Compare(templatePath, noRelationships), [], PackageValidationService.ReadSectionSnapshots(templatePath));
        if (relationReport.Relationships.IsComplete)
            throw new InvalidDataException("Missing document relationships were not detected.");

        var mutated = Path.Combine(directory, "section-mutated.docx");
        File.Copy(templatePath, mutated, true);
        using (var document = WordprocessingDocument.Open(mutated, true))
        {
            var firstSection = document.MainDocumentPart!.Document!.Body!.Descendants<Paragraph>().Select(p => p.ParagraphProperties?.SectionProperties).First(section => section is not null)!;
            var margin = firstSection.GetFirstChild<PageMargin>() ?? firstSection.AppendChild(new PageMargin());
            margin.Left = 999;
            firstSection.GetFirstChild<HeaderReference>()!.Id = "rIdMutated";
            document.MainDocumentPart.Document.Save();
        }
        var sectionReport = PackageValidationService.Validate(mutated, PackageComparer.Compare(templatePath, mutated), [], PackageValidationService.ReadSectionSnapshots(templatePath));
        if (sectionReport.SectionPreservationErrors.Count == 0)
            throw new InvalidDataException("Section margin/header-reference mutation escaped structural validation.");
    }
}

public sealed record RegressionCaseResult(
    string Name,
    bool Passed,
    WordValidationReport? FirstValidation,
    WordValidationReport? SecondValidation,
    CapabilityReport? Capabilities,
    string? Error);

public sealed record RegressionSuiteResult(
    bool Success,
    string OutputDirectory,
    IReadOnlyList<RegressionCaseResult> Cases,
    WordApplicationValidationResult? WordValidation);
