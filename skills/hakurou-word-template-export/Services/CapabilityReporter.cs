using DocumentFormat.OpenXml.Packaging;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

public static class CapabilityReporter
{
    public static CapabilityReport Build(
        string templatePath,
        DocxFragmentImporter.FragmentImportAnalysis analysis,
        PackageComparison? comparison)
    {
        var supported = new HashSet<string>(analysis.SupportedFeatures, StringComparer.Ordinal);
        var preserved = new HashSet<string>(StringComparer.Ordinal);
        var unsupported = new HashSet<string>(analysis.Gaps.Select(gap => gap.Feature), StringComparer.Ordinal);
        var potentiallyLossy = new HashSet<string>(analysis.PotentiallyLossyFeatures, StringComparer.Ordinal);

        using (var document = WordprocessingDocument.Open(templatePath, false))
        {
            var main = document.MainDocumentPart;
            if (main?.Document?.Body is not null)
            {
                supported.Add("sections");
                if (main.Document.Body.Descendants<DocumentFormat.OpenXml.Wordprocessing.Columns>().Any()) supported.Add("columns");
                if (main.Document.Descendants<DocumentFormat.OpenXml.Wordprocessing.BookmarkStart>().Any()) supported.Add("bookmark");
                if (main.Document.Descendants<DocumentFormat.OpenXml.Wordprocessing.SdtElement>().Any()) supported.Add("content-control");
            }
            if (main?.HeaderParts.Any() == true) supported.Add("header");
            if (main?.FooterParts.Any() == true) supported.Add("footer");
        }

        if (comparison is not null)
        {
            var touched = comparison.ChangedParts.Concat(comparison.AddedParts).Concat(comparison.RemovedParts)
                .Select(part => part.Path)
                .ToHashSet(StringComparer.Ordinal);
            AddPreservedIfUntouched(preserved, touched, "styles", "word/styles.xml");
            AddPreservedIfUntouched(preserved, touched, "settings", "word/settings.xml");
            AddPreservedIfUntouched(preserved, touched, "header", "word/header");
            AddPreservedIfUntouched(preserved, touched, "footer", "word/footer");
            AddPreservedIfUntouched(preserved, touched, "theme", "word/theme/");
            AddPreservedIfUntouched(preserved, touched, "custom XML", "customXml/");
        }

        return new CapabilityReport(
            supported.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            preserved.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            unsupported.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            potentiallyLossy.OrderBy(value => value, StringComparer.Ordinal).ToArray());
    }

    private static void AddPreservedIfUntouched(ISet<string> preserved, ISet<string> touched, string feature, string partPrefix)
    {
        if (!touched.Any(path => path.StartsWith(partPrefix, StringComparison.OrdinalIgnoreCase))) preserved.Add(feature);
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
