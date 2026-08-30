using System.IO.Compression;
using System.Security.Cryptography;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

public static class PackageComparer
{
    public static PackageComparison Compare(string baselinePath, string candidatePath)
    {
        var baseline = ReadParts(baselinePath);
        var candidate = ReadParts(candidatePath);
        var changed = new List<PackagePartChange>();
        var added = new List<PackagePartChange>();
        var removed = new List<PackagePartChange>();

        foreach (var (path, part) in candidate.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            if (!baseline.TryGetValue(path, out var original))
            {
                added.Add(part);
            }
            else if (part.Length != original.Length || !StringComparer.Ordinal.Equals(part.Sha256, original.Sha256))
            {
                changed.Add(part);
            }
        }

        foreach (var (path, part) in baseline.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            if (!candidate.ContainsKey(path)) removed.Add(part);
        }

        return new PackageComparison(changed, added, removed);
    }

    private static Dictionary<string, PackagePartChange> ReadParts(string packagePath)
    {
        using var archive = ZipFile.OpenRead(packagePath);
        var result = new Dictionary<string, PackagePartChange>(StringComparer.Ordinal);
        foreach (var entry in archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name)))
        {
            using var stream = entry.Open();
            var hash = Convert.ToHexString(SHA256.HashData(stream));
            result.Add(entry.FullName, new PackagePartChange(entry.FullName, entry.Length, hash));
        }
        return result;
    }
}
