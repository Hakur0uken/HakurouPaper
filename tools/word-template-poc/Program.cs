using System.Text.Json;
using System.Text;
using Hakurou.WordTemplatePoc.Models;
using Hakurou.WordTemplatePoc.Services;

Console.InputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);
Console.OutputEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

var serializerOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    WriteIndented = true,
};

try
{
    if (args.Length == 0) throw new ArgumentException("Expected inspect-template, parse-markdown, render-template, roundtrip-template, validate-with-word, run-regression, prepare-test-template, prepare-range-mapped-template, prepare-section-safe-mapped-template, or prepare-bookmark-test-template.");
    object result = args[0] switch
    {
        "inspect-template" => InspectTemplate(args[1..]),
        "parse-markdown" => ParseMarkdown(args[1..]),
        "render-template" => RenderTemplate(),
        "roundtrip-template" => RoundtripTemplate(args[1..]),
        "validate-with-word" => ValidateWithWord(args[1..]),
        "run-regression" => RunRegression(args[1..]),
        "prepare-test-template" => PrepareTestTemplate(args[1..]),
        "prepare-range-mapped-template" => PrepareRangeMappedTemplate(args[1..]),
        "prepare-section-safe-mapped-template" => PrepareSectionSafeMappedTemplate(args[1..]),
        "prepare-bookmark-test-template" => PrepareBookmarkTestTemplate(args[1..]),
        _ => throw new ArgumentException($"Unknown command: {args[0]}"),
    };
    Console.Out.WriteLine(JsonSerializer.Serialize(result, serializerOptions));
}
catch (Exception exception)
{
    Console.Out.WriteLine(JsonSerializer.Serialize(new CliFailure(false, exception.Message), serializerOptions));
    Environment.ExitCode = 2;
}

TemplateInspection InspectTemplate(string[] commandArgs)
{
    if (commandArgs.Length is < 1 or > 3) throw new ArgumentException("Usage: inspect-template <template.docx> [--report <output.json>]");
    var inspection = TemplateAnalyzer.Inspect(commandArgs[0]);
    if (commandArgs.Length == 3 && commandArgs[1] == "--report")
    {
        var reportPath = Path.GetFullPath(commandArgs[2]);
        Directory.CreateDirectory(Path.GetDirectoryName(reportPath) ?? throw new InvalidOperationException("Report path has no parent directory."));
        File.WriteAllText(reportPath, JsonSerializer.Serialize(inspection, serializerOptions));
    }
    return inspection;
}

SemanticDocument ParseMarkdown(string[] commandArgs)
{
    if (commandArgs.Length != 2) throw new ArgumentException("Usage: parse-markdown <pandoc-path> <working-directory>; Markdown is read from stdin.");
    return new SemanticMarkdownParser(commandArgs[0], commandArgs[1]).Parse(Console.In.ReadToEnd());
}

RenderTemplateResult RenderTemplate()
{
    var request = JsonSerializer.Deserialize<RenderTemplateRequest>(Console.In.ReadToEnd(), serializerOptions)
        ?? throw new InvalidDataException("render-template requires a JSON request on stdin.");
    return TemplateRenderer.Render(request);
}

RoundtripResult RoundtripTemplate(string[] commandArgs)
{
    if (commandArgs.Length != 2) throw new ArgumentException("Usage: roundtrip-template <template.docx> <output.docx>");
    return RoundtripService.Roundtrip(commandArgs[0], commandArgs[1]);
}

WordApplicationValidationResult ValidateWithWord(string[] commandArgs)
{
    if (commandArgs.Length != 2) throw new ArgumentException("Usage: validate-with-word <input.docx> <saveas-output.docx>");
    return WindowsWordValidationService.Validate(commandArgs[0], commandArgs[1]);
}

RegressionSuiteResult RunRegression(string[] commandArgs)
{
    if (commandArgs.Length is < 3 or > 4) throw new ArgumentException("Usage: run-regression <pandoc-path> <fixture.md> <output-directory> [--with-word]");
    var withWord = commandArgs.Length == 4 && commandArgs[3] == "--with-word";
    if (commandArgs.Length == 4 && !withWord) throw new ArgumentException("The only optional run-regression flag is --with-word.");
    return RegressionSuite.Run(commandArgs[0], commandArgs[1], commandArgs[2], withWord);
}

object PrepareTestTemplate(string[] commandArgs)
{
    if (commandArgs.Length != 2) throw new ArgumentException("Usage: prepare-test-template <source.docx> <output.docx>");
    FixtureBuilder.CreateInstrumentedCopy(commandArgs[0], commandArgs[1]);
    return new { success = true, outputPath = Path.GetFullPath(commandArgs[1]) };
}

object PrepareBookmarkTestTemplate(string[] commandArgs)
{
    if (commandArgs.Length != 2) throw new ArgumentException("Usage: prepare-bookmark-test-template <source.docx> <output.docx>");
    FixtureBuilder.CreateBookmarkInstrumentedCopy(commandArgs[0], commandArgs[1]);
    return new { success = true, outputPath = Path.GetFullPath(commandArgs[1]) };
}

object PrepareRangeMappedTemplate(string[] commandArgs)
{
    if (commandArgs.Length != 7)
        throw new ArgumentException("Usage: prepare-range-mapped-template <source.docx> <output.docx> <title-start> <title-end> <abstract-start> <abstract-end> <body-start>");

    var positions = commandArgs[2..]
        .Select(value => int.TryParse(value, out var position)
            ? position
            : throw new ArgumentException($"Mapping position must be an integer: {value}"))
        .ToArray();
    FixtureBuilder.CreateExplicitRangeMappedCopy(
        commandArgs[0],
        commandArgs[1],
        new ExplicitRangeMapping(
            positions[0],
            positions[1],
            positions[2],
            positions[3],
            positions[4]));
    return new { success = true, outputPath = Path.GetFullPath(commandArgs[1]), mapping = positions };
}

object PrepareSectionSafeMappedTemplate(string[] commandArgs)
{
    if (commandArgs.Length is < 8 or > 9)
        throw new ArgumentException("Usage: prepare-section-safe-mapped-template <source.docx> <output.docx> <title-start> <title-end> <abstract-start> <abstract-end> <body-start> <body-end> [<clear-start>:<clear-end>[,...]]");

    var positions = commandArgs[2..8]
        .Select(value => int.TryParse(value, out var position)
            ? position
            : throw new ArgumentException($"Mapping position must be an integer: {value}"))
        .ToArray();
    var clearRanges = commandArgs.Length == 9
        ? commandArgs[8]
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(range => range.Split(':', StringSplitOptions.TrimEntries))
            .Select(parts => parts.Length == 2 && int.TryParse(parts[0], out var start) && int.TryParse(parts[1], out var end)
                ? new DirectBodyRange(start, end)
                : throw new ArgumentException($"Clear range must use start:end syntax: {string.Join(':', parts)}"))
            .ToArray()
        : Array.Empty<DirectBodyRange>();
    FixtureBuilder.CreateSectionSafeMappedCopy(
        commandArgs[0],
        commandArgs[1],
        new SectionSafeRangeMapping(
            new DirectBodyRange(positions[0], positions[1]),
            new DirectBodyRange(positions[2], positions[3]),
            new DirectBodyRange(positions[4], positions[5]),
            clearRanges));
    return new { success = true, outputPath = Path.GetFullPath(commandArgs[1]), mapping = positions, clearRanges };
}
