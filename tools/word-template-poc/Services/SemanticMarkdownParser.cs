using System.Diagnostics;
using System.Text.Json;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Uses Pandoc's AST instead of implementing a Markdown parser. The PoC only
/// identifies an H1 title and an Abstract/摘要 section; all remaining syntax is
/// delegated back to Pandoc when the body fragment is built.
/// </summary>
public sealed class SemanticMarkdownParser
{
    private readonly string _pandocPath;
    private readonly string _workingDirectory;

    public SemanticMarkdownParser(string pandocPath, string workingDirectory)
    {
        _pandocPath = Path.GetFullPath(pandocPath);
        _workingDirectory = Path.GetFullPath(workingDirectory);
    }

    public SemanticDocument Parse(string markdown)
    {
        var ast = RunPandoc(markdown, ["--from=markdown", "--to=json"]);
        using var document = JsonDocument.Parse(ast);
        var pandocApiVersion = document.RootElement.GetProperty("pandoc-api-version").Clone();
        var blocks = document.RootElement.GetProperty("blocks")
            .EnumerateArray()
            .Select(block => block.Clone())
            .ToList();

        var titleIndex = -1;
        string? title = null;
        for (var index = 0; index < blocks.Count; index++)
        {
            if (!TryGetHeader(blocks[index], out var level) || level != 1) continue;
            titleIndex = index;
            title = ConvertBlocks(blocks[index..(index + 1)], "plain", pandocApiVersion).Trim();
            break;
        }

        var abstractIndex = -1;
        var abstractEnd = -1;
        string? abstractText = null;
        for (var index = 0; index < blocks.Count; index++)
        {
            if (!TryGetHeader(blocks[index], out var level)) continue;
            var heading = ConvertBlocks(blocks[index..(index + 1)], "plain", pandocApiVersion).Trim();
            if (!IsAbstractHeading(heading)) continue;

            abstractIndex = index;
            abstractEnd = index + 1;
            while (abstractEnd < blocks.Count)
            {
                if (TryGetHeader(blocks[abstractEnd], out var nextLevel) && nextLevel <= level) break;
                abstractEnd++;
            }
            abstractText = ConvertBlocks(blocks[(index + 1)..abstractEnd], "plain", pandocApiVersion).Trim();
            break;
        }

        var bodyBlocks = blocks
            .Where((_, index) => index != titleIndex && (abstractIndex < 0 || index < abstractIndex || index >= abstractEnd))
            .ToArray();
        var bodyMarkdown = ConvertBlocks(bodyBlocks, "markdown", pandocApiVersion).Trim();
        return new SemanticDocument(title, string.IsNullOrWhiteSpace(abstractText) ? null : abstractText, bodyMarkdown, bodyBlocks.Length);
    }

    public string BuildBodyFragment(string bodyMarkdown, string destinationPath)
    {
        var outputPath = Path.GetFullPath(destinationPath);
        RunPandoc(bodyMarkdown, [
            "--from=markdown",
            "--to=docx",
            "--standalone",
            $"--resource-path={_workingDirectory}",
            "--output",
            outputPath,
            "-",
        ]);
        return outputPath;
    }

    private static bool TryGetHeader(JsonElement block, out int level)
    {
        level = 0;
        if (!block.TryGetProperty("t", out var type) || type.GetString() != "Header") return false;
        if (!block.TryGetProperty("c", out var contents) || contents.ValueKind != JsonValueKind.Array || contents.GetArrayLength() < 1) return false;
        level = contents[0].GetInt32();
        return true;
    }

    private static bool IsAbstractHeading(string heading) =>
        string.Equals(heading, "Abstract", StringComparison.OrdinalIgnoreCase)
        || string.Equals(heading, "摘要", StringComparison.Ordinal);

    private string ConvertBlocks(IReadOnlyList<JsonElement> blocks, string outputFormat, JsonElement pandocApiVersion)
    {
        var payload = JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["pandoc-api-version"] = pandocApiVersion,
            ["meta"] = new Dictionary<string, object?>(),
            ["blocks"] = blocks,
        });
        return RunPandoc(payload, ["--from=json", $"--to={outputFormat}", "--wrap=none"]);
    }

    private string RunPandoc(string standardInput, IReadOnlyList<string> arguments)
    {
        var start = new ProcessStartInfo
        {
            FileName = _pandocPath,
            WorkingDirectory = _workingDirectory,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        foreach (var argument in arguments) start.ArgumentList.Add(argument);

        using var process = Process.Start(start)
            ?? throw new InvalidOperationException("Unable to start Pandoc.");
        process.StandardInput.Write(standardInput);
        process.StandardInput.Close();
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"Pandoc failed ({process.ExitCode}): {stderr.Trim()}");
        return stdout;
    }
}
