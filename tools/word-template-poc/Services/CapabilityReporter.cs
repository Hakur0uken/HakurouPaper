using DocumentFormat.OpenXml.Packaging;
using System.IO.Compression;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

public static class CapabilityReporter
{
    public static CapabilityReport Build(
        string templatePath,
        DocxFragmentImporter.FragmentImportAnalysis analysis,
        PackageComparison? comparison,
        WordValidationReport? validation = null)
    {
        var supported = new HashSet<string>(analysis.SupportedFeatures, StringComparer.Ordinal);
        var preserved = new HashSet<string>(StringComparer.Ordinal);
        var unsupported = new HashSet<string>(analysis.Gaps.Select(gap => gap.Feature), StringComparer.Ordinal);
        var potentiallyLossy = new HashSet<string>(analysis.PotentiallyLossyFeatures, StringComparer.Ordinal);

        var presentParts = ReadPartNames(templatePath);
        using (var document = WordprocessingDocument.Open(templatePath, false))
        {
            var main = document.MainDocumentPart;
            if (main?.Document?.Body is not null)
            {
                // Sections and columns are template-owned structure. They are
                // never advertised as importer-created capabilities.
                if (main.Document.Descendants<DocumentFormat.OpenXml.Wordprocessing.BookmarkStart>().Any()) supported.Add("bookmark");
                if (main.Document.Descendants<DocumentFormat.OpenXml.Wordprocessing.SdtElement>().Any()) supported.Add("content-control");
            }
        }

        if (comparison is not null)
        {
            var touched = comparison.ChangedParts.Concat(comparison.AddedParts).Concat(comparison.RemovedParts)
                .Select(part => part.Path)
                .ToHashSet(StringComparer.Ordinal);
            AddPreservedIfPresentAndUntouched(preserved, presentParts, touched, "styles", "word/styles.xml");
            AddPreservedIfPresentAndUntouched(preserved, presentParts, touched, "settings", "word/settings.xml");
            AddPreservedIfPresentAndUntouched(preserved, presentParts, touched, "header", "word/header");
            AddPreservedIfPresentAndUntouched(preserved, presentParts, touched, "footer", "word/footer");
            AddPreservedIfPresentAndUntouched(preserved, presentParts, touched, "theme", "word/theme/");
            AddPreservedIfPresentAndUntouched(preserved, presentParts, touched, "custom XML", "customXml/");
            if (validation?.SectionPreservationErrors.Count == 0)
            {
                if (validation.SectionSnapshots.Count > 0) preserved.Add("sections");
                if (validation.Columns.Any(column => column > 1)) preserved.Add("columns");
            }
        }

        return new CapabilityReport(
            supported.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            preserved.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            unsupported.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            potentiallyLossy.OrderBy(value => value, StringComparer.Ordinal).ToArray());
    }

    private static HashSet<string> ReadPartNames(string path)
    {
        using var archive = ZipFile.OpenRead(path);
        return archive.Entries.Where(entry => !string.IsNullOrEmpty(entry.Name))
            .Select(entry => entry.FullName).ToHashSet(StringComparer.OrdinalIgnoreCase);
    }

    private static void AddPreservedIfPresentAndUntouched(ISet<string> preserved, ISet<string> present, ISet<string> touched, string feature, string partPrefix)
    {
        if (present.Any(path => path.StartsWith(partPrefix, StringComparison.OrdinalIgnoreCase))
            && !touched.Any(path => path.StartsWith(partPrefix, StringComparison.OrdinalIgnoreCase))) preserved.Add(feature);
    }
}

public static class PackagePreservationPolicy
{
    public static IReadOnlyList<string> FindUnexpectedChanges(
        PackageComparison comparison,
        DocxFragmentImporter.FragmentImportAnalysis analysis)
    {
        var unexpected = new List<string>();
        foreach (var part in comparison.ChangedParts.Concat(comparison.AddedParts))
        {
            if (!IsAllowed(part.Path, analysis)) unexpected.Add(part.Path);
        }
        // The importer never removes package parts. A removal is always a
        // regression, even if its name happens to look related to the body.
        unexpected.AddRange(comparison.RemovedParts.Select(part => part.Path));
        return unexpected.Distinct(StringComparer.Ordinal).OrderBy(path => path, StringComparer.Ordinal).ToArray();
    }

    private static bool IsAllowed(string path, DocxFragmentImporter.FragmentImportAnalysis analysis)
    {
        if (string.Equals(path, "word/document.xml", StringComparison.OrdinalIgnoreCase)) return true;
        if (analysis.RequiresRelationshipChanges || analysis.RequiresNumberingChanges)
        {
            if (string.Equals(path, "word/_rels/document.xml.rels", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(path, "[Content_Types].xml", StringComparison.OrdinalIgnoreCase)) return true;
        }
        if (analysis.ImageRelationshipIds.Count > 0 && (path.StartsWith("word/media/", StringComparison.OrdinalIgnoreCase) || path.StartsWith("media/", StringComparison.OrdinalIgnoreCase))) return true;
        return analysis.RequiresNumberingChanges && string.Equals(path, "word/numbering.xml", StringComparison.OrdinalIgnoreCase);
    }
}
