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
    if (args.Length == 0) throw new ArgumentException("Expected inspect-template, parse-markdown, render-template, roundtrip-template, validate-with-word, run-regression, prepare-test-template, or prepare-bookmark-test-template.");
    object result = args[0] switch
    {
        "inspect-template" => InspectTemplate(args[1..]),
        "parse-markdown" => ParseMarkdown(args[1..]),
        "render-template" => RenderTemplate(),
        "roundtrip-template" => RoundtripTemplate(args[1..]),
        "validate-with-word" => ValidateWithWord(args[1..]),
        "run-regression" => RunRegression(args[1..]),
        "prepare-test-template" => PrepareTestTemplate(args[1..]),
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
