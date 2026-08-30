using Hakurou.WordTemplatePoc.Models;
using OfficeIMO.Word;

namespace Hakurou.WordTemplatePoc.Services;

public static class RoundtripService
{
    public static RoundtripResult Roundtrip(string templatePath, string outputPath)
    {
        var logs = new List<string>();
        try
        {
            var source = Path.GetFullPath(templatePath);
            var destination = Path.GetFullPath(outputPath);
            Directory.CreateDirectory(Path.GetDirectoryName(destination) ?? throw new InvalidOperationException("Output path has no parent directory."));
            File.Copy(source, destination, true);
            logs.Add($"[Roundtrip] Copied {source}");
            using (var document = WordDocument.Load(destination))
            {
                logs.Add($"[OfficeIMO] Loaded projected document with {document.Sections.Count} section(s)");
                document.Save();
            }
            var preservation = PackageComparer.Compare(source, destination);
            logs.Add($"[Preservation] changed={preservation.ChangedParts.Count}, added={preservation.AddedParts.Count}, removed={preservation.RemovedParts.Count}");
            return new RoundtripResult(true, destination, preservation, logs);
        }
        catch (Exception exception)
        {
            logs.Add($"[Error] {exception.Message}");
            return new RoundtripResult(false, Path.GetFullPath(outputPath), new PackageComparison([], [], []), logs, exception.Message);
        }
    }
}
