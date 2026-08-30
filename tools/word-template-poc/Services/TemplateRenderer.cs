using System.Text.Json;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

public static class TemplateRenderer
{
    private static readonly JsonSerializerOptions ReportSerializerOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    public static RenderTemplateResult Render(RenderTemplateRequest request)
    {
        var logs = new List<string>();
        var templatePath = Path.GetFullPath(request.TemplatePath);
        var outputPath = Path.GetFullPath(request.OutputPath);
        var mapping = request.Mapping ?? new MappingPlan();
        var semanticParser = new SemanticMarkdownParser(request.PandocPath, request.WorkingDirectory);

        try
        {
            var semantic = semanticParser.Parse(request.Markdown);
            logs.Add($"[Semantic] {(semantic.Title is null ? "Title not detected" : "Title detected")}");
            logs.Add($"[Semantic] {(semantic.Abstract is null ? "Abstract not detected" : "Abstract detected")}");
            logs.Add($"[Semantic] Body blocks: {semantic.BodyBlockCount}");

            var temporaryDirectory = Path.Combine(Path.GetTempPath(), "hakurou-word-template-poc", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(temporaryDirectory);
            try
            {
                var fragmentPath = semanticParser.BuildBodyFragment(semantic.BodyMarkdown, Path.Combine(temporaryDirectory, "body-fragment.docx"));
                DocxFragmentImporter.FragmentImportAnalysis analysis;
                TemplateAnchors.MappingResolution targetResolution;
                using (var fragment = WordprocessingDocument.Open(fragmentPath, false))
                using (var sourceTemplate = WordprocessingDocument.Open(templatePath, false))
                {
                    analysis = DocxFragmentImporter.Analyze(fragment, sourceTemplate);
                    var mainPart = sourceTemplate.MainDocumentPart
                        ?? throw new InvalidDataException("The template has no MainDocumentPart.");
                    targetResolution = TemplateAnchors.Resolve(mainPart, mapping, bodyRequiresBlockContent: true);
                }

                foreach (var gap in analysis.Gaps)
                    logs.Add($"[Gap] {gap.Code}: {gap.Detail}");
                foreach (var issue in targetResolution.Issues)
                    logs.Add($"[Mapping] {issue}");
                if (targetResolution.MissingTargets.Count > 0)
                {
                    logs.Add($"[Mapping] Unresolved targets: {string.Join(", ", targetResolution.MissingTargets)}");
                    return new RenderTemplateResult(
                        false,
                        null,
                        semantic,
                        targetResolution.MissingTargets,
                        null,
                        [],
                        logs,
                        "Template mapping is incomplete.",
                        Capabilities: CapabilityReporter.Build(templatePath, analysis, null),
                        Gaps: analysis.Gaps,
                        AnchorIssues: targetResolution.Issues);
                }
                if (targetResolution.Issues.Count > 0 || analysis.HasBlockingGaps)
                {
                    var error = targetResolution.Issues.Count > 0
                        ? "Template anchors are incompatible with this injection."
                        : "Fragment contains unsupported dependencies.";
                    return new RenderTemplateResult(
                        false,
                        null,
                        semantic,
                        [],
                        null,
                        [],
                        logs,
                        error,
                        Capabilities: CapabilityReporter.Build(templatePath, analysis, null),
                        Gaps: analysis.Gaps,
                        AnchorIssues: targetResolution.Issues);
                }

                var outputDirectory = Path.GetDirectoryName(outputPath) ?? throw new InvalidOperationException("Output path has no parent directory.");
                Directory.CreateDirectory(outputDirectory);
                var temporaryOutputPath = Path.Combine(outputDirectory, $".{Path.GetFileName(outputPath)}.{Guid.NewGuid():N}.tmp.docx");
                var validationReportPath = Path.Combine(outputDirectory, $"{Path.GetFileNameWithoutExtension(outputPath)}.validation.json");
                var temporaryReportPath = Path.Combine(outputDirectory, $".{Path.GetFileName(validationReportPath)}.{Guid.NewGuid():N}.tmp.json");
                try
                {
                    File.Copy(templatePath, temporaryOutputPath, false);
                    var existingIds = DocxFragmentImporter.ReadExistingPackageIds(temporaryOutputPath);
                    var baselineSections = PackageValidationService.ReadSectionSnapshots(templatePath);
                    using (var template = WordprocessingDocument.Open(temporaryOutputPath, true))
                    using (var fragment = WordprocessingDocument.Open(fragmentPath, false))
                    {
                        var mainPart = template.MainDocumentPart
                            ?? throw new InvalidDataException("The template has no MainDocumentPart.");
                        var writableResolution = TemplateAnchors.Resolve(mainPart, mapping, bodyRequiresBlockContent: true);
                        if (writableResolution.MissingTargets.Count > 0 || writableResolution.Issues.Count > 0)
                            throw new InvalidDataException("Template targets changed unexpectedly after the preflight copy.");
                        InsertPlainText(writableResolution.Targets[mapping.Title], semantic.Title ?? string.Empty, "Title", logs);
                        InsertPlainText(writableResolution.Targets[mapping.Abstract], semantic.Abstract ?? string.Empty, "Abstract", logs);
                        var body = mainPart.Document?.Body ?? throw new InvalidDataException("The template has no main document body.");
                        var layout = SectionLayoutResolver.Resolve(body, GetAnchorElement(writableResolution.Targets[mapping.Body]));
                        logs.Add($"[Layout] body section {layout.SectionIndex}; effective column width {layout.EffectiveColumnWidthTwips} twips");
                        var imported = DocxFragmentImporter.ImportBodyChildren(fragment, template, analysis, existingIds, layout, logs);
                        InsertBody(writableResolution.Targets[mapping.Body], imported, logs);
                        mainPart.Document.Save();
                    }

                    var preservation = PackageComparer.Compare(templatePath, temporaryOutputPath);
                    var unexpectedChanges = PackagePreservationPolicy.FindUnexpectedChanges(preservation, analysis);
                    var validationReport = PackageValidationService.Validate(temporaryOutputPath, preservation, unexpectedChanges, baselineSections);
                    foreach (var change in preservation.ChangedParts) logs.Add($"[Preservation] changed: {change.Path}");
                    foreach (var addition in preservation.AddedParts) logs.Add($"[Preservation] added: {addition.Path}");
                    foreach (var removal in preservation.RemovedParts) logs.Add($"[Preservation] removed: {removal.Path}");
                    foreach (var unexpected in unexpectedChanges) logs.Add($"[Preservation] unexpected: {unexpected}");
                    logs.Add($"[Validation] OpenXmlValidator: {(validationReport.OpenXmlValidatorPassed ? "passed" : "failed")}");
                    logs.Add($"[Validation] relationship integrity: {(validationReport.Relationships.IsComplete ? "passed" : "failed")}");
                    if (!validationReport.Passed)
                    {
                        logs.Add("[Output] validation failed; temporary output discarded");
                        return new RenderTemplateResult(false, null, semantic, [], preservation, validationReport.OpenXmlValidationErrors, logs,
                            "Word package validation or preservation regression failed.", validationReport, null,
                            CapabilityReporter.Build(templatePath, analysis, preservation, validationReport), analysis.Gaps, targetResolution.Issues);
                    }

                    File.WriteAllText(temporaryReportPath, JsonSerializer.Serialize(validationReport, ReportSerializerOptions));
                    PublishAtomically(temporaryOutputPath, outputPath);
                    PublishAtomically(temporaryReportPath, validationReportPath);
                    logs.Add($"[Validation] developer report: {validationReportPath}");
                    logs.Add($"[Output] {outputPath}");
                    return new RenderTemplateResult(true, outputPath, semantic, [], preservation, validationReport.OpenXmlValidationErrors, logs,
                        null, validationReport, validationReportPath,
                        CapabilityReporter.Build(templatePath, analysis, preservation, validationReport), analysis.Gaps, targetResolution.Issues);
                }
                finally
                {
                    DeleteIfExists(temporaryOutputPath);
                    DeleteIfExists(temporaryReportPath);
                }
            }
            finally
            {
                if (Directory.Exists(temporaryDirectory)) Directory.Delete(temporaryDirectory, true);
            }
        }
        catch (Exception exception)
        {
            logs.Add($"[Error] {exception.Message}");
            return new RenderTemplateResult(false, null, null, [], null, [], logs, exception.Message);
        }
    }

    private static OpenXmlElement GetAnchorElement(TemplateAnchors.TargetLocation location) =>
        (OpenXmlElement?)location.ContentControl ?? location.Bookmark ?? throw new InvalidDataException("Missing template anchor.");

    private static void InsertPlainText(
        TemplateAnchors.TargetLocation location,
        string value,
        string semanticName,
        ICollection<string> logs)
    {
        if (location.ContentControl is not null) ReplaceContentControlText(location.ContentControl, value);
        else ReplaceBookmarkText(location.Bookmark ?? throw new InvalidDataException("Missing bookmark target."), value);
        logs.Add($"[Injection] {semanticName} inserted");
    }

    private static void InsertBody(
        TemplateAnchors.TargetLocation location,
        IReadOnlyList<OpenXmlElement> elements,
        ICollection<string> logs)
    {
        if (location.ContentControl is SdtBlock block)
        {
            var content = block.SdtContentBlock ?? throw new InvalidDataException("The body content control has no block content.");
            content.RemoveAllChildren();
            foreach (var element in elements) content.AppendChild(element);
        }
        else if (location.ContentControl is not null)
        {
            throw new InvalidOperationException("The body target must be a block-level content control or a dedicated bookmark paragraph.");
        }
        else
        {
            var bookmark = location.Bookmark ?? throw new InvalidDataException("Missing bookmark target.");
            var paragraph = bookmark.Ancestors<Paragraph>().FirstOrDefault()
                ?? throw new InvalidOperationException("The body bookmark must be inside a paragraph.");
            foreach (var element in elements) paragraph.InsertBeforeSelf(element);
            paragraph.Remove();
        }
        logs.Add("[Mapping] body -> deterministic anchor");
    }

    private static void ReplaceContentControlText(SdtElement control, string value)
    {
        switch (control)
        {
            case SdtRun run:
                ReplaceRunContainer(run.SdtContentRun ?? throw new InvalidDataException("The run content control has no content."), value);
                break;
            case SdtBlock block:
                var blockContent = block.SdtContentBlock ?? throw new InvalidDataException("The block content control has no content.");
                var sourceParagraph = blockContent.Descendants<Paragraph>().FirstOrDefault();
                blockContent.RemoveAllChildren();
                blockContent.AppendChild(CreateParagraphLike(sourceParagraph, value));
                break;
            case SdtCell cell:
                var cellContent = cell.SdtContentCell ?? throw new InvalidDataException("The cell content control has no content.");
                var paragraph = cellContent.Descendants<Paragraph>().FirstOrDefault();
                if (paragraph is null) cellContent.AppendChild(CreateParagraphLike(null, value));
                else ReplaceParagraphText(paragraph, value);
                break;
            default:
                throw new InvalidOperationException($"Unsupported content-control type: {control.GetType().Name}");
        }
    }

    private static void ReplaceRunContainer(SdtContentRun content, string value)
    {
        var properties = content.Descendants<RunProperties>().FirstOrDefault()?.CloneNode(true) as RunProperties;
        content.RemoveAllChildren();
        content.AppendChild(CreateRun(value, properties));
    }

    private static void ReplaceBookmarkText(BookmarkStart bookmark, string value)
    {
        var paragraph = bookmark.Ancestors<Paragraph>().FirstOrDefault()
            ?? throw new InvalidOperationException("The bookmark target must be inside a paragraph.");
        var id = bookmark.Id?.Value ?? throw new InvalidOperationException("The bookmark target has no ID.");
        var end = paragraph.ChildElements.OfType<BookmarkEnd>()
            .SingleOrDefault(candidate => string.Equals(candidate.Id?.Value, id, StringComparison.Ordinal))
            ?? throw new InvalidOperationException("The bookmark target has no direct matching end.");
        var children = paragraph.ChildElements.ToArray();
        var startIndex = Array.IndexOf(children, bookmark);
        var endIndex = Array.IndexOf(children, end);
        if (startIndex < 0 || endIndex <= startIndex)
            throw new InvalidOperationException("The bookmark target is not a direct inline range.");
        var sourceProperties = children.Skip(startIndex + 1).Take(endIndex - startIndex - 1)
            .OfType<Run>().SelectMany(run => run.Elements<RunProperties>()).FirstOrDefault();
        foreach (var child in children.Skip(startIndex + 1).Take(endIndex - startIndex - 1).ToArray()) child.Remove();
        end.InsertBeforeSelf(CreateRun(value, sourceProperties?.CloneNode(true) as RunProperties));
    }

    private static void PublishAtomically(string temporaryPath, string finalPath) =>
        // Both paths live in the destination directory. This is a rename, not
        // a copy/delete publication sequence.
        File.Move(temporaryPath, finalPath, overwrite: true);

    private static void DeleteIfExists(string path)
    {
        if (File.Exists(path)) File.Delete(path);
    }

    private static void ReplaceParagraphText(Paragraph paragraph, string value)
    {
        var paragraphProperties = paragraph.ParagraphProperties?.CloneNode(true) as ParagraphProperties;
        var runProperties = paragraph.Descendants<RunProperties>().FirstOrDefault()?.CloneNode(true) as RunProperties;
        var starts = paragraph.Descendants<BookmarkStart>().Select(bookmark => bookmark.CloneNode(true)).ToArray();
        var ends = paragraph.Descendants<BookmarkEnd>().Select(bookmark => bookmark.CloneNode(true)).ToArray();
        paragraph.RemoveAllChildren();
        if (paragraphProperties is not null) paragraph.AppendChild(paragraphProperties);
        foreach (var start in starts) paragraph.AppendChild(start);
        paragraph.AppendChild(CreateRun(value, runProperties));
        foreach (var end in ends) paragraph.AppendChild(end);
    }

    private static Paragraph CreateParagraphLike(Paragraph? source, string value)
    {
        var paragraph = new Paragraph();
        if (source?.ParagraphProperties is not null) paragraph.AppendChild((ParagraphProperties)source.ParagraphProperties.CloneNode(true));
        paragraph.AppendChild(CreateRun(value, source?.Descendants<RunProperties>().FirstOrDefault()?.CloneNode(true) as RunProperties));
        return paragraph;
    }

    private static Run CreateRun(string value, RunProperties? properties)
    {
        var run = new Run();
        if (properties is not null) run.AppendChild(properties);
        run.AppendChild(new Text(value) { Space = SpaceProcessingModeValues.Preserve });
        return run;
    }
}
