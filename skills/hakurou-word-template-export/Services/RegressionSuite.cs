using System.Text.Json;
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
                EnsurePassed(first, fixture.Name, baseline);
                var second = TemplateRenderer.Render(new RenderTemplateRequest(
                    first.OutputPath ?? throw new InvalidDataException("First output is missing."),
                    Path.Combine(secondDirectory, "output.docx"),
                    markdown,
                    Path.GetFullPath(pandocPath),
                    root));
                EnsurePassed(second, $"{fixture.Name} second insertion", baseline);

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
        }
        catch (Exception exception)
        {
            cases.Add(new RegressionCaseResult("suite", false, null, null, null, exception.Message));
        }

        var succeeded = cases.Count == 8 && cases.All(item => item.Passed)
            && (wordValidation is null || wordValidation.Success);
        var result = new RegressionSuiteResult(succeeded, root, cases, wordValidation);
        File.WriteAllText(Path.Combine(root, "regression-summary.json"), JsonSerializer.Serialize(result, JsonOptions));
        return result;
    }

    private static void EnsurePassed(RenderTemplateResult result, string name, TemplateInspection baseline)
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
        if (!numberingTouched) throw new InvalidDataException($"{name}: numbering.xml was not merged for the numbered-list fixture.");
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
