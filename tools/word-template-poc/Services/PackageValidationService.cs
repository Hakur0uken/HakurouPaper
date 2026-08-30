using System.IO.Compression;
using System.Xml.Linq;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using DocumentFormat.OpenXml.Wordprocessing;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Validation intentionally combines SDK schema validation with package-level
/// checks. The latter catches relationship and identity mistakes that schema
/// validation alone cannot express.
/// </summary>
public static class PackageValidationService
{
    private const string WordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private const string DrawingNamespace = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    private const string RelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    private const string PackageRelationshipNamespace = "http://schemas.openxmlformats.org/package/2006/relationships";

    public static WordValidationReport Validate(
        string candidatePath,
        PackageComparison comparison,
        IReadOnlyList<string> unexpectedChangedParts)
    {
        var validationErrors = ValidateOpenXml(candidatePath);
        var danglingRelationships = FindDanglingRelationships(candidatePath);
        var duplicateIds = FindDuplicateIds(candidatePath);
        var (sections, columns, sectPrCount) = ReadSections(candidatePath);
        var passed = validationErrors.Count == 0
            && danglingRelationships.Count == 0
            && duplicateIds.Count == 0
            && unexpectedChangedParts.Count == 0;

        return new WordValidationReport(
            validationErrors.Count == 0,
            validationErrors,
            new RelationshipValidation(danglingRelationships.Count == 0, danglingRelationships),
            duplicateIds,
            sections,
            columns,
            sectPrCount,
            comparison,
            unexpectedChangedParts,
            passed);
    }

    private static IReadOnlyList<string> ValidateOpenXml(string path)
    {
        using var document = WordprocessingDocument.Open(path, false);
        var validator = new OpenXmlValidator(DocumentFormat.OpenXml.FileFormatVersions.Office2019);
        return validator.Validate(document)
            .Select(error => $"{error.Description} ({error.Path?.XPath})")
            .Take(100)
            .ToArray();
    }

    private static IReadOnlyList<string> FindDanglingRelationships(string packagePath)
    {
        using var archive = ZipFile.OpenRead(packagePath);
        var entries = archive.Entries
            .Where(entry => !string.IsNullOrEmpty(entry.Name))
            .ToDictionary(entry => entry.FullName, StringComparer.Ordinal);
        var errors = new List<string>();
        var relationshipIdsBySource = new Dictionary<string, HashSet<string>>(StringComparer.Ordinal);

        foreach (var entry in entries.Values.Where(entry => entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase)))
        {
            var sourcePart = RelationshipSourcePart(entry.FullName);
            if (sourcePart is null) continue;
            var relationshipIds = new HashSet<string>(StringComparer.Ordinal);
            var xml = LoadXml(entry);
            foreach (var relationship in xml.Root?.Elements(XName.Get("Relationship", PackageRelationshipNamespace)) ?? [])
            {
                var id = (string?)relationship.Attribute("Id");
                var target = (string?)relationship.Attribute("Target");
                var targetMode = (string?)relationship.Attribute("TargetMode");
                if (!string.IsNullOrWhiteSpace(id)) relationshipIds.Add(id);
                if (string.IsNullOrWhiteSpace(target) || string.Equals(targetMode, "External", StringComparison.OrdinalIgnoreCase)) continue;
                var resolvedTarget = ResolveRelationshipTarget(sourcePart, target);
                if (!entries.ContainsKey(resolvedTarget))
                    errors.Add($"{entry.FullName}: relationship {id ?? "(no id)"} targets missing part {resolvedTarget}");
            }
            relationshipIdsBySource[sourcePart] = relationshipIds;
        }

        foreach (var entry in entries.Values.Where(IsXmlPart))
        {
            var partPath = entry.FullName;
            if (!relationshipIdsBySource.TryGetValue(partPath, out var knownIds)) continue;
            var xml = LoadXml(entry);
            foreach (var attribute in xml.Descendants().Attributes().Where(IsRelationshipReference))
            {
                if (!knownIds.Contains(attribute.Value))
                    errors.Add($"{partPath}: {attribute.Name.LocalName} references missing relationship {attribute.Value}");
            }
        }

        return errors.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToArray();
    }

    private static IReadOnlyList<DuplicateIdFinding> FindDuplicateIds(string packagePath)
    {
        using var archive = ZipFile.OpenRead(packagePath);
        var findings = new List<DuplicateIdFinding>();
        var docProperties = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var bookmarks = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var bookmarkNames = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var abstractNumbers = new Dictionary<string, List<string>>(StringComparer.Ordinal);
        var numbers = new Dictionary<string, List<string>>(StringComparer.Ordinal);

        foreach (var entry in archive.Entries.Where(IsXmlPart))
        {
            var xml = LoadXml(entry);
            foreach (var element in xml.Descendants(XName.Get("docPr", DrawingNamespace)))
                Add(docProperties, (string?)element.Attribute("id"), entry.FullName);
            foreach (var element in xml.Descendants(XName.Get("bookmarkStart", WordNamespace)))
            {
                Add(bookmarks, (string?)element.Attribute(XName.Get("id", WordNamespace)), entry.FullName);
                Add(bookmarkNames, (string?)element.Attribute(XName.Get("name", WordNamespace)), entry.FullName);
            }
            if (string.Equals(entry.FullName, "word/numbering.xml", StringComparison.OrdinalIgnoreCase))
            {
                foreach (var element in xml.Descendants(XName.Get("abstractNum", WordNamespace)))
                    Add(abstractNumbers, (string?)element.Attribute(XName.Get("abstractNumId", WordNamespace)), entry.FullName);
                foreach (var element in xml.Descendants(XName.Get("num", WordNamespace)))
                    Add(numbers, (string?)element.Attribute(XName.Get("numId", WordNamespace)), entry.FullName);
            }
        }

        AddDuplicates(findings, "wp:docPr id", docProperties);
        AddDuplicates(findings, "bookmark id", bookmarks);
        AddDuplicates(findings, "bookmark name", bookmarkNames);
        AddDuplicates(findings, "abstractNumId", abstractNumbers);
        AddDuplicates(findings, "numId", numbers);
        return findings.OrderBy(finding => finding.Kind, StringComparer.Ordinal)
            .ThenBy(finding => finding.Value, StringComparer.Ordinal)
            .ToArray();
    }

    private static (int Sections, IReadOnlyList<int> Columns, int SectPrCount) ReadSections(string path)
    {
        using var document = WordprocessingDocument.Open(path, false);
        var body = document.MainDocumentPart?.Document?.Body
            ?? throw new InvalidDataException("The document has no main body.");
        var sectionProperties = body.Descendants<Paragraph>()
            .Select(paragraph => paragraph.ParagraphProperties?.SectionProperties)
            .Where(section => section is not null)
            .Cast<SectionProperties>()
            .Concat(body.Elements<SectionProperties>())
            .ToArray();
        return (
            sectionProperties.Length,
            sectionProperties.Select(section => (int)(section.GetFirstChild<Columns>()?.ColumnCount?.Value ?? 1)).ToArray(),
            sectionProperties.Length);
    }

    private static bool IsXmlPart(ZipArchiveEntry entry) =>
        !string.IsNullOrEmpty(entry.Name)
        && entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)
        && !entry.FullName.EndsWith(".rels", StringComparison.OrdinalIgnoreCase);

    private static bool IsRelationshipReference(XAttribute attribute) =>
        string.Equals(attribute.Name.NamespaceName, RelationshipNamespace, StringComparison.Ordinal)
        && attribute.Name.LocalName is "id" or "embed" or "link";

    private static XDocument LoadXml(ZipArchiveEntry entry)
    {
        using var stream = entry.Open();
        return XDocument.Load(stream, LoadOptions.PreserveWhitespace);
    }

    private static string? RelationshipSourcePart(string relationshipPartPath)
    {
        if (string.Equals(relationshipPartPath, "_rels/.rels", StringComparison.OrdinalIgnoreCase)) return string.Empty;
        var marker = "/_rels/";
        var markerIndex = relationshipPartPath.IndexOf(marker, StringComparison.Ordinal);
        if (markerIndex < 0 || !relationshipPartPath.EndsWith(".rels", StringComparison.OrdinalIgnoreCase)) return null;
        var directory = relationshipPartPath[..markerIndex];
        var fileName = relationshipPartPath[(markerIndex + marker.Length)..^5];
        return string.IsNullOrEmpty(directory) ? fileName : $"{directory}/{fileName}";
    }

    private static string ResolveRelationshipTarget(string sourcePart, string target)
    {
        var baseUri = new Uri($"http://package.local/{sourcePart}", UriKind.Absolute);
        return new Uri(baseUri, target).AbsolutePath.TrimStart('/');
    }

    private static void Add(IDictionary<string, List<string>> values, string? value, string location)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        if (!values.TryGetValue(value, out var locations))
        {
            locations = [];
            values.Add(value, locations);
        }
        locations.Add(location);
    }

    private static void AddDuplicates(
        ICollection<DuplicateIdFinding> findings,
        string kind,
        IReadOnlyDictionary<string, List<string>> values)
    {
        foreach (var (value, locations) in values.Where(pair => pair.Value.Count > 1))
            findings.Add(new DuplicateIdFinding(kind, value, locations.OrderBy(location => location, StringComparer.Ordinal).ToArray()));
    }
}
