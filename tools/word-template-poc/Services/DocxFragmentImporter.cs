using System.IO.Compression;
using System.Xml.Linq;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Wordprocessing;
using Hakurou.WordTemplatePoc.Models;

namespace Hakurou.WordTemplatePoc.Services;

/// <summary>
/// Imports body-only DOCX fragments as a package-aware operation. It first
/// proves every used dependency is understood, then performs only the local
/// package changes required for relationships, IDs and numbering.
/// </summary>
public static class DocxFragmentImporter
{
    private const string WordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private const string DrawingNamespace = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
    private const string DrawingMlNamespace = "http://schemas.openxmlformats.org/drawingml/2006/main";
    private const string RelationshipNamespace = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    public static FragmentImportAnalysis Analyze(WordprocessingDocument fragment, WordprocessingDocument template)
    {
        var sourceMain = fragment.MainDocumentPart
            ?? throw new InvalidDataException("The Pandoc fragment has no MainDocumentPart.");
        var destinationMain = template.MainDocumentPart
            ?? throw new InvalidDataException("The template has no MainDocumentPart.");
        var roots = GetInsertableChildren(sourceMain).ToArray();
        var gaps = new List<ImportGap>();
        var supported = new HashSet<string>(StringComparer.Ordinal);
        var potentiallyLossy = new HashSet<string>(StringComparer.Ordinal);
        var relationshipIds = new HashSet<string>(StringComparer.Ordinal);
        var imageRelationshipIds = new HashSet<string>(StringComparer.Ordinal);
        var hyperlinkRelationshipIds = new HashSet<string>(StringComparer.Ordinal);
        var sourceBookmarks = GetBookmarkDefinitions(roots);
        var sourceBookmarkNames = sourceBookmarks
            .Where(bookmark => bookmark.Name is not null)
            .Select(bookmark => bookmark.Name!)
            .ToHashSet(StringComparer.Ordinal);
        var destinationBookmarkNames = GetBookmarkNames(destinationMain.Document?.Body?.ChildElements ?? []);
        var numberingIds = GetNumberingIds(roots);

        DetectFeatures(roots, supported, gaps, potentiallyLossy);
        AnalyzeRelationships(sourceMain, roots, relationshipIds, imageRelationshipIds, hyperlinkRelationshipIds, gaps, supported);
        AnalyzeInternalHyperlinks(roots, sourceBookmarkNames, destinationBookmarkNames, gaps, supported);
        var styleMap = StyleMap.Create(sourceMain, destinationMain);
        foreach (var missingStyle in styleMap.FindMissingReferences(roots))
            gaps.Add(new ImportGap("missing-style", "style", $"Fragment uses style '{missingStyle}' that is absent from the template; styles are intentionally not copied in this PoC."));
        if (styleMap.HasMappedReferences(roots)) supported.Add("style references");
        if (styleMap.HasFallbackReferences(roots)) potentiallyLossy.Add("generic paragraph/table style fallback");
        AnalyzeNumbering(sourceMain, numberingIds, gaps, supported);

        return new FragmentImportAnalysis(
            imageRelationshipIds,
            hyperlinkRelationshipIds,
            numberingIds,
            sourceBookmarks,
            gaps,
            supported.OrderBy(value => value, StringComparer.Ordinal).ToArray(),
            potentiallyLossy.OrderBy(value => value, StringComparer.Ordinal).ToArray());
    }

    public static IReadOnlyList<OpenXmlElement> ImportBodyChildren(
        WordprocessingDocument fragment,
        WordprocessingDocument template,
        FragmentImportAnalysis analysis,
        ExistingPackageIds existingIds,
        SectionLayoutContext layout,
        ICollection<string> logs)
    {
        if (analysis.Gaps.Any(gap => gap.Blocking))
            throw new InvalidOperationException($"Fragment has unsupported dependencies: {string.Join("; ", analysis.Gaps.Where(gap => gap.Blocking).Select(gap => gap.Code))}");

        var sourceMain = fragment.MainDocumentPart
            ?? throw new InvalidDataException("The Pandoc fragment has no MainDocumentPart.");
        var destinationMain = template.MainDocumentPart
            ?? throw new InvalidDataException("The template has no MainDocumentPart.");
        var styleMap = StyleMap.Create(sourceMain, destinationMain);
        var relationshipMap = CopyRelationships(sourceMain, destinationMain, analysis, logs);
        var numberingMap = MergeNumbering(sourceMain, destinationMain, analysis.NumberingIds, logs);
        var bookmarkMaps = BuildBookmarkMaps(analysis.SourceBookmarks, destinationMain, existingIds, logs);
        var drawingIdAllocator = new NumericIdAllocator(existingIds.DrawingDocPropertyIds);
        var sourceSectPrRemoved = false;
        var imported = new List<OpenXmlElement>();

        foreach (var child in GetInsertableChildren(sourceMain))
        {
            var clone = child.CloneNode(true);
            foreach (var paragraphProperties in clone.Descendants<ParagraphProperties>().ToArray())
            {
                if (paragraphProperties.SectionProperties is null) continue;
                paragraphProperties.SectionProperties.Remove();
                sourceSectPrRemoved = true;
            }
            styleMap.Apply(clone);
            RewriteRelationshipReferences(clone, relationshipMap);
            RewriteNumberingReferences(clone, numberingMap);
            RewriteBookmarksAndInternalLinks(clone, bookmarkMaps, drawingIdAllocator);
            ApplyLayoutConstraints(clone, layout, analysis, logs);
            imported.Add(clone);
        }

        sourceSectPrRemoved = sourceMain.Document?.Body?.Elements<SectionProperties>().Any() == true || sourceSectPrRemoved;
        logs.Add($"[Injection] Body fragment inserted: {imported.Count} top-level elements");
        logs.Add(sourceSectPrRemoved
            ? "[Injection] Removed source sectPr before template insertion"
            : "[Injection] Source fragment did not contain an explicit sectPr");
        if (relationshipMap.Count > 0)
            logs.Add($"[Injection] Remapped {relationshipMap.Count} relationship(s) into the template package");
        if (numberingMap.Count > 0)
            logs.Add($"[Injection] Remapped {numberingMap.Count} numbering instance(s)");
        return imported;
    }

    private static void ApplyLayoutConstraints(
        OpenXmlElement root,
        SectionLayoutContext layout,
        FragmentImportAnalysis analysis,
        ICollection<string> logs)
    {
        var maxImageWidth = layout.EffectiveColumnWidthEmus;
        var downscaledImages = 0;
        foreach (var inline in AllElements([root]).Where(element => element.LocalName == "inline" && element.NamespaceUri == DrawingNamespace))
        {
            var extent = inline.Descendants().FirstOrDefault(element => element.LocalName == "extent" && element.NamespaceUri == DrawingNamespace);
            if (extent is null) continue;
            var width = ReadLongAttribute(extent, "cx");
            var height = ReadLongAttribute(extent, "cy");
            if (width is null || height is null || width <= 0 || height <= 0 || width <= maxImageWidth) continue;
            var ratio = (double)maxImageWidth / width.Value;
            var newWidth = maxImageWidth;
            var newHeight = Math.Max(1L, (long)Math.Round(height.Value * ratio, MidpointRounding.AwayFromZero));
            SetNoNamespaceAttribute(extent, "cx", newWidth);
            SetNoNamespaceAttribute(extent, "cy", newHeight);
            foreach (var transformExtent in inline.Descendants().Where(element => element.LocalName == "ext"
                && element.NamespaceUri == DrawingMlNamespace
                && element.Ancestors().Any(ancestor => ancestor.LocalName == "xfrm" && ancestor.NamespaceUri == DrawingMlNamespace)))
            {
                SetNoNamespaceAttribute(transformExtent, "cx", newWidth);
                SetNoNamespaceAttribute(transformExtent, "cy", newHeight);
            }
            downscaledImages++;
        }
        if (downscaledImages > 0) logs.Add($"[Layout] Downscaled {downscaledImages} inline image(s) to {layout.EffectiveColumnWidthTwips} twips or less");

        foreach (var table in AllElements([root]).OfType<Table>())
            FitTableToColumn(table, layout, analysis, logs);
    }

    private static void FitTableToColumn(
        Table table,
        SectionLayoutContext layout,
        FragmentImportAnalysis analysis,
        ICollection<string> logs)
    {
        var gridColumns = table.Descendants<TableGrid>().SelectMany(grid => grid.Elements<GridColumn>()).ToArray();
        var gridWidth = gridColumns.Sum(column => ReadWordAttributeInt(column, "w") ?? 0);
        var tableWidth = table.TableProperties?.TableWidth is { } width
            && width.Type?.Value == TableWidthUnitValues.Dxa
            ? int.TryParse(width.Width?.Value, out var dxa) ? dxa : 0
            : 0;
        var measuredWidth = Math.Max(gridWidth, tableWidth);
        if (measuredWidth <= layout.EffectiveColumnWidthTwips || measuredWidth == 0) return;

        var ratio = (double)layout.EffectiveColumnWidthTwips / measuredWidth;
        if (ratio < 0.70)
        {
            analysis.AddPotentiallyLossy("table too wide for current column");
            logs.Add($"[Layout] table width {measuredWidth} twips exceeds current column {layout.EffectiveColumnWidthTwips} twips; left unrotated");
            return;
        }
        foreach (var column in gridColumns)
        {
            var original = ReadWordAttributeInt(column, "w");
            if (original is not null) SetWordAttribute(column, "w", Math.Max(1, (int)Math.Round(original.Value * ratio)));
        }
        foreach (var cellWidth in table.Descendants<TableCellWidth>().Where(width => width.Type?.Value == TableWidthUnitValues.Dxa))
            if (int.TryParse(cellWidth.Width?.Value, out var original)) cellWidth.Width = Math.Max(1, (int)Math.Round(original * ratio)).ToString(System.Globalization.CultureInfo.InvariantCulture);
        if (table.TableProperties?.TableWidth is { } targetWidth)
        {
            targetWidth.Width = layout.EffectiveColumnWidthTwips.ToString(System.Globalization.CultureInfo.InvariantCulture);
            targetWidth.Type = TableWidthUnitValues.Dxa;
        }
        if (table.TableProperties is not null)
        {
            var tableLayout = table.TableProperties.TableLayout ?? table.TableProperties.AppendChild(new TableLayout());
            tableLayout.Type = TableLayoutValues.Autofit;
        }
        logs.Add($"[Layout] scaled a simple table to current column width ({layout.EffectiveColumnWidthTwips} twips)");
    }

    public static ExistingPackageIds ReadExistingPackageIds(string packagePath)
    {
        using var archive = ZipFile.OpenRead(packagePath);
        var drawingIds = new HashSet<uint>();
        var bookmarkIds = new HashSet<uint>();
        foreach (var entry in archive.Entries.Where(entry => entry.FullName.EndsWith(".xml", StringComparison.OrdinalIgnoreCase)))
        {
            using var stream = entry.Open();
            var xml = XDocument.Load(stream);
            foreach (var docProperty in xml.Descendants(XName.Get("docPr", DrawingNamespace)))
            {
                if (uint.TryParse((string?)docProperty.Attribute("id"), out var id)) drawingIds.Add(id);
            }
            foreach (var bookmark in xml.Descendants(XName.Get("bookmarkStart", WordNamespace)))
            {
                if (uint.TryParse((string?)bookmark.Attribute(XName.Get("id", WordNamespace)), out var id)) bookmarkIds.Add(id);
            }
        }
        return new ExistingPackageIds(drawingIds, bookmarkIds);
    }

    private static IEnumerable<OpenXmlElement> GetInsertableChildren(MainDocumentPart sourceMain)
    {
        var body = sourceMain.Document?.Body
            ?? throw new InvalidDataException("The Pandoc fragment has no body.");
        return body.ChildElements.Where(child => child is not SectionProperties);
    }

    private static void DetectFeatures(
        IReadOnlyList<OpenXmlElement> roots,
        ISet<string> supported,
        ICollection<ImportGap> gaps,
        ISet<string> potentiallyLossy)
    {
        var elements = AllElements(roots).ToArray();
        if (elements.Any(element => element is Paragraph)) supported.Add("paragraph");
        if (elements.Any(element => element is Table)) supported.Add("table");
        if (elements.Any(element => element.LocalName is "oMath" or "oMathPara")) supported.Add("equation");
        if (elements.Any(element => element is Bold)) supported.Add("bold");
        if (elements.Any(element => element is Italic)) supported.Add("italic");
        if (elements.Any(IsHeadingStyle)) supported.Add("heading");
        if (elements.Any(element => element.LocalName == "footnoteReference" && element.NamespaceUri == WordNamespace))
            gaps.Add(new ImportGap("unsupported-footnote", "footnote", "Fragment contains a footnote reference; footnote parts are not imported."));
        if (elements.Any(element => element.LocalName == "endnoteReference" && element.NamespaceUri == WordNamespace))
            gaps.Add(new ImportGap("unsupported-endnote", "endnote", "Fragment contains an endnote reference; endnote parts are not imported."));
        if (elements.Any(element => element.LocalName is "commentRangeStart" or "commentRangeEnd" or "commentReference" && element.NamespaceUri == WordNamespace))
            gaps.Add(new ImportGap("unsupported-comment", "comment", "Fragment contains comment markup; comments parts are not imported."));
        if (elements.Any(element => element.LocalName == "AlternateContent"))
        {
            potentiallyLossy.Add("alternate content");
            gaps.Add(new ImportGap("unsupported-alternate-content", "alternate content", "Fragment contains markup compatibility alternatives that this importer does not select or normalize."));
        }
        foreach (var element in elements.Where(element => element.OuterXml.Contains("OLEObject", StringComparison.Ordinal)
                                                         || element.OuterXml.Contains("<c:chart", StringComparison.Ordinal)
                                                         || element.OuterXml.Contains("<dgm:", StringComparison.Ordinal)))
        {
            var feature = element.OuterXml.Contains("OLEObject", StringComparison.Ordinal) ? "OLE" : element.OuterXml.Contains("<c:chart", StringComparison.Ordinal) ? "chart" : "SmartArt";
            gaps.Add(new ImportGap($"unsupported-{feature.ToLowerInvariant()}", feature, $"Fragment contains {feature} markup; complex dependent parts are not imported."));
        }
    }

    private static void AnalyzeRelationships(
        MainDocumentPart sourceMain,
        IReadOnlyList<OpenXmlElement> roots,
        ISet<string> relationshipIds,
        ISet<string> imageRelationshipIds,
        ISet<string> hyperlinkRelationshipIds,
        ICollection<ImportGap> gaps,
        ISet<string> supported)
    {
        foreach (var reference in AllElements(roots).SelectMany(element => element.GetAttributes()).Where(IsRelationshipReference))
        {
            var relationshipId = reference.Value ?? string.Empty;
            if (string.IsNullOrWhiteSpace(relationshipId) || !relationshipIds.Add(relationshipId)) continue;
            var hyperlink = sourceMain.HyperlinkRelationships.FirstOrDefault(item => string.Equals(item.Id, relationshipId, StringComparison.Ordinal));
            if (hyperlink is not null)
            {
                if (!hyperlink.IsExternal)
                {
                    gaps.Add(new ImportGap("unsupported-internal-relationship", "internal relationship", $"Relationship '{relationshipId}' is a non-external hyperlink relationship."));
                    continue;
                }
                hyperlinkRelationshipIds.Add(relationshipId);
                supported.Add("external hyperlink");
                continue;
            }

            try
            {
                if (sourceMain.GetPartById(relationshipId) is ImagePart)
                {
                    imageRelationshipIds.Add(relationshipId);
                    supported.Add("png");
                    continue;
                }
            }
            catch (KeyNotFoundException)
            {
                // The gap below is more actionable than the SDK's lookup exception.
            }
            gaps.Add(new ImportGap("unsupported-relationship", "relationship", $"Fragment uses relationship '{relationshipId}' that is not an image or external hyperlink."));
        }

        foreach (var blip in AllElements(roots).Where(element => element.LocalName == "blip"))
        {
            if (blip.GetAttributes().Any(attribute => attribute.NamespaceUri == RelationshipNamespace && attribute.LocalName == "link"))
                gaps.Add(new ImportGap("unsupported-linked-image", "linked image", "Fragment uses an externally linked image rather than an embedded image."));
        }
    }

    private static void AnalyzeInternalHyperlinks(
        IReadOnlyList<OpenXmlElement> roots,
        ISet<string> sourceBookmarkNames,
        ISet<string> destinationBookmarkNames,
        ICollection<ImportGap> gaps,
        ISet<string> supported)
    {
        var anchors = AllElements(roots)
            .OfType<Hyperlink>()
            .Select(link => link.Anchor?.Value)
            .Where(anchor => !string.IsNullOrWhiteSpace(anchor))
            .Cast<string>()
            .Distinct(StringComparer.Ordinal)
            .ToArray();
        foreach (var anchor in anchors)
        {
            if (!sourceBookmarkNames.Contains(anchor) && !destinationBookmarkNames.Contains(anchor))
                gaps.Add(new ImportGap("dangling-internal-hyperlink", "internal hyperlink", $"Fragment hyperlink anchor '{anchor}' is not a fragment or template bookmark."));
            else supported.Add("internal hyperlink");
        }
    }

    private static void AnalyzeNumbering(
        MainDocumentPart sourceMain,
        IReadOnlyCollection<int> numberingIds,
        ICollection<ImportGap> gaps,
        ISet<string> supported)
    {
        if (numberingIds.Count == 0) return;
        var numbering = sourceMain.NumberingDefinitionsPart?.Numbering;
        if (numbering is null)
        {
            gaps.Add(new ImportGap("missing-numbering-part", "numbering", "Fragment paragraphs reference numbering but word/numbering.xml is absent."));
            return;
        }
        foreach (var numId in numberingIds)
        {
            var number = FindById(numbering, "num", "numId", numId);
            if (number is null)
            {
                gaps.Add(new ImportGap("missing-numbering-instance", "numbering", $"Fragment references numId {numId}, but no matching w:num exists."));
                continue;
            }
            var abstractReference = number.Descendants().FirstOrDefault(element => element.LocalName == "abstractNumId" && element.NamespaceUri == WordNamespace);
            var abstractId = ReadWordAttributeInt(abstractReference, "val");
            var abstractNumber = abstractId is null ? null : FindById(numbering, "abstractNum", "abstractNumId", abstractId.Value);
            if (abstractNumber is null)
                gaps.Add(new ImportGap("missing-abstract-numbering", "numbering", $"Fragment numId {numId} does not resolve to an abstract numbering definition."));
            else if (abstractNumber.Descendants().Any(element => (element.LocalName is "lvlPicBulletId" or "numPicBulletId") && element.NamespaceUri == WordNamespace))
                gaps.Add(new ImportGap("unsupported-picture-bullet", "numbering", $"Fragment numId {numId} uses picture-bullet numbering, which requires additional image dependencies."));
            else if (abstractNumber.Descendants().Any(element => (element.LocalName is "styleLink" or "numStyleLink") && element.NamespaceUri == WordNamespace))
                gaps.Add(new ImportGap("unsupported-numbering-style-link", "numbering", $"Fragment numId {numId} uses a numbering style link that is not imported."));
        }
        if (!gaps.Any(gap => gap.Feature == "numbering" && gap.Blocking)) supported.Add("numbering");
    }

    private static Dictionary<string, string> CopyRelationships(
        MainDocumentPart sourceMain,
        MainDocumentPart destinationMain,
        FragmentImportAnalysis analysis,
        ICollection<string> logs)
    {
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var sourceId in analysis.ImageRelationshipIds.OrderBy(value => value, StringComparer.Ordinal))
        {
            if (sourceMain.GetPartById(sourceId) is not ImagePart sourceImage)
                throw new InvalidDataException($"Pandoc image relationship '{sourceId}' is not an ImagePart.");
            var destinationImage = destinationMain.AddImagePart(sourceImage.ContentType);
            using (var sourceStream = sourceImage.GetStream(FileMode.Open, FileAccess.Read))
            using (var destinationStream = destinationImage.GetStream(FileMode.Create, FileAccess.Write))
                sourceStream.CopyTo(destinationStream);
            map.Add(sourceId, destinationMain.GetIdOfPart(destinationImage));
        }
        foreach (var sourceId in analysis.HyperlinkRelationshipIds.OrderBy(value => value, StringComparer.Ordinal))
        {
            var sourceRelationship = sourceMain.HyperlinkRelationships
                .Single(relationship => string.Equals(relationship.Id, sourceId, StringComparison.Ordinal));
            var destinationRelationship = destinationMain.AddHyperlinkRelationship(sourceRelationship.Uri, true);
            map.Add(sourceId, destinationRelationship.Id);
        }
        if (analysis.ImageRelationshipIds.Count > 0) logs.Add($"[Injection] Copied {analysis.ImageRelationshipIds.Count} image relationship(s)");
        if (analysis.HyperlinkRelationshipIds.Count > 0) logs.Add($"[Injection] Copied {analysis.HyperlinkRelationshipIds.Count} external hyperlink relationship(s)");
        return map;
    }

    private static Dictionary<int, int> MergeNumbering(
        MainDocumentPart sourceMain,
        MainDocumentPart destinationMain,
        IReadOnlyCollection<int> sourceNumberIds,
        ICollection<string> logs)
    {
        if (sourceNumberIds.Count == 0) return [];
        var sourceNumbering = sourceMain.NumberingDefinitionsPart?.Numbering
            ?? throw new InvalidDataException("Fragment numbering disappeared after preflight.");
        var destinationPart = destinationMain.NumberingDefinitionsPart;
        if (destinationPart is null)
        {
            destinationPart = destinationMain.AddNewPart<NumberingDefinitionsPart>();
            destinationPart.Numbering = new Numbering();
        }
        var destinationNumbering = destinationPart.Numbering ??= new Numbering();
        var nextNumberId = new NumericIdAllocator(GetIds(destinationNumbering, "num", "numId").Select(id => (uint)id));
        var nextAbstractId = new NumericIdAllocator(GetIds(destinationNumbering, "abstractNum", "abstractNumId").Select(id => (uint)id));
        var abstractMap = new Dictionary<int, int>();
        var numberMap = new Dictionary<int, int>();

        foreach (var sourceNumberId in sourceNumberIds.OrderBy(id => id))
        {
            var sourceNumber = FindById(sourceNumbering, "num", "numId", sourceNumberId)
                ?? throw new InvalidDataException($"Missing source numId {sourceNumberId} after preflight.");
            var sourceAbstractReference = sourceNumber.Descendants().First(element => element.LocalName == "abstractNumId" && element.NamespaceUri == WordNamespace);
            var sourceAbstractId = ReadWordAttributeInt(sourceAbstractReference, "val")
                ?? throw new InvalidDataException($"Missing abstract numbering ID for numId {sourceNumberId}.");
            if (!abstractMap.TryGetValue(sourceAbstractId, out var destinationAbstractId))
            {
                var sourceAbstract = FindById(sourceNumbering, "abstractNum", "abstractNumId", sourceAbstractId)
                    ?? throw new InvalidDataException($"Missing source abstractNumId {sourceAbstractId} after preflight.");
                destinationAbstractId = checked((int)nextAbstractId.Next());
                var clonedAbstract = sourceAbstract.CloneNode(true);
                SetWordAttribute(clonedAbstract, "abstractNumId", destinationAbstractId);
                var firstNumber = destinationNumbering.ChildElements.FirstOrDefault(element => element.LocalName == "num" && element.NamespaceUri == WordNamespace);
                if (firstNumber is null) destinationNumbering.AppendChild(clonedAbstract);
                else destinationNumbering.InsertBefore(clonedAbstract, firstNumber);
                abstractMap.Add(sourceAbstractId, destinationAbstractId);
            }
            var destinationNumberId = checked((int)nextNumberId.Next());
            var clonedNumber = sourceNumber.CloneNode(true);
            SetWordAttribute(clonedNumber, "numId", destinationNumberId);
            var clonedAbstractReference = clonedNumber.Descendants().First(element => element.LocalName == "abstractNumId" && element.NamespaceUri == WordNamespace);
            SetWordAttribute(clonedAbstractReference, "val", destinationAbstractId);
            destinationNumbering.AppendChild(clonedNumber);
            numberMap.Add(sourceNumberId, destinationNumberId);
        }
        destinationNumbering.Save();
        logs.Add($"[Injection] Merged {abstractMap.Count} abstractNum and {numberMap.Count} num definition(s)");
        return numberMap;
    }

    private static BookmarkMaps BuildBookmarkMaps(
        IReadOnlyCollection<BookmarkDefinition> sourceBookmarks,
        MainDocumentPart destinationMain,
        ExistingPackageIds existingIds,
        ICollection<string> logs)
    {
        var destinationNames = GetBookmarkNames(destinationMain.Document?.Body?.ChildElements ?? []);
        var destinationIds = destinationMain.Document?.Descendants<BookmarkStart>()
            .Select(bookmark => uint.TryParse(bookmark.Id?.Value, out var id) ? id : 0)
            .Where(id => id > 0) ?? [];
        var idAllocator = new NumericIdAllocator(destinationIds.Concat(existingIds.BookmarkIds));
        var idMap = new Dictionary<string, uint>(StringComparer.Ordinal);
        var nameMap = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var sourceBookmark in sourceBookmarks.OrderBy(bookmark => bookmark.Id, StringComparer.Ordinal))
        {
            if (idMap.ContainsKey(sourceBookmark.Id)) continue;
            idMap.Add(sourceBookmark.Id, idAllocator.Next());
            if (sourceBookmark.Name is null || nameMap.ContainsKey(sourceBookmark.Name)) continue;
            var destinationName = AllocateBookmarkName(sourceBookmark.Name, destinationNames);
            destinationNames.Add(destinationName);
            nameMap.Add(sourceBookmark.Name, destinationName);
        }
        if (idMap.Count > 0) logs.Add($"[Injection] Remapped {idMap.Count} bookmark ID(s) and {nameMap.Count} bookmark name(s)");
        return new BookmarkMaps(idMap, nameMap);
    }

    private static void RewriteRelationshipReferences(OpenXmlElement root, IReadOnlyDictionary<string, string> relationshipMap)
    {
        foreach (var element in AllElements([root]))
        {
            foreach (var attribute in element.GetAttributes().Where(IsRelationshipReference).ToArray())
            {
                if (string.IsNullOrWhiteSpace(attribute.Value) || !relationshipMap.TryGetValue(attribute.Value, out var replacement)) continue;
                element.SetAttribute(new OpenXmlAttribute(attribute.Prefix, attribute.LocalName, attribute.NamespaceUri, replacement));
            }
        }
    }

    private static void RewriteNumberingReferences(OpenXmlElement root, IReadOnlyDictionary<int, int> numberMap)
    {
        foreach (var numberId in root.Descendants().Where(element => element.LocalName == "numId" && element.NamespaceUri == WordNamespace))
        {
            var sourceId = ReadWordAttributeInt(numberId, "val");
            if (sourceId is not null && numberMap.TryGetValue(sourceId.Value, out var destinationId))
                SetWordAttribute(numberId, "val", destinationId);
        }
    }

    private static void RewriteBookmarksAndInternalLinks(
        OpenXmlElement root,
        BookmarkMaps bookmarkMaps,
        NumericIdAllocator drawingIdAllocator)
    {
        foreach (var start in root.Descendants<BookmarkStart>())
        {
            var sourceId = start.Id?.Value;
            var sourceName = start.Name?.Value;
            if (sourceId is not null && bookmarkMaps.Ids.TryGetValue(sourceId, out var destinationId))
                start.Id = destinationId.ToString(System.Globalization.CultureInfo.InvariantCulture);
            if (sourceName is not null && bookmarkMaps.Names.TryGetValue(sourceName, out var destinationName))
                start.Name = destinationName;
        }
        foreach (var end in root.Descendants<BookmarkEnd>())
        {
            var sourceId = end.Id?.Value;
            if (sourceId is not null && bookmarkMaps.Ids.TryGetValue(sourceId, out var destinationId))
                end.Id = destinationId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        }
        foreach (var hyperlink in root.Descendants<Hyperlink>())
        {
            var sourceAnchor = hyperlink.Anchor?.Value;
            if (sourceAnchor is not null && bookmarkMaps.Names.TryGetValue(sourceAnchor, out var destinationName)) hyperlink.Anchor = destinationName;
        }
        foreach (var docProperty in root.Descendants().Where(element => element.LocalName == "docPr" && element.NamespaceUri == DrawingNamespace))
            SetNoNamespaceAttribute(docProperty, "id", drawingIdAllocator.Next());
    }

    private static IEnumerable<OpenXmlElement> AllElements(IEnumerable<OpenXmlElement> roots) =>
        roots.SelectMany(root => new[] { root }.Concat(root.Descendants()));

    private static HashSet<string> GetBookmarkNames(IEnumerable<OpenXmlElement> roots) =>
        AllElements(roots)
            .OfType<BookmarkStart>()
            .Select(bookmark => bookmark.Name?.Value)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Cast<string>()
            .ToHashSet(StringComparer.Ordinal);

    private static IReadOnlyCollection<BookmarkDefinition> GetBookmarkDefinitions(IEnumerable<OpenXmlElement> roots) =>
        AllElements(roots)
            .OfType<BookmarkStart>()
            .Select(bookmark => new { Id = bookmark.Id?.Value, Name = bookmark.Name?.Value })
            .Where(bookmark => !string.IsNullOrWhiteSpace(bookmark.Id))
            .Select(bookmark => new BookmarkDefinition(bookmark.Id!, string.IsNullOrWhiteSpace(bookmark.Name) ? null : bookmark.Name))
            .Distinct()
            .ToArray();

    private static HashSet<int> GetNumberingIds(IEnumerable<OpenXmlElement> roots) =>
        AllElements(roots)
            .Where(element => element.LocalName == "numId" && element.NamespaceUri == WordNamespace)
            .Select(element => ReadWordAttributeInt(element, "val"))
            .Where(id => id is not null)
            .Select(id => id!.Value)
            .ToHashSet();

    private static IEnumerable<int> GetIds(OpenXmlElement root, string elementName, string attributeName) =>
        root.ChildElements
            .Where(element => element.LocalName == elementName && element.NamespaceUri == WordNamespace)
            .Select(element => ReadWordAttributeInt(element, attributeName))
            .Where(id => id is not null)
            .Select(id => id!.Value);

    private static OpenXmlElement? FindById(OpenXmlElement root, string elementName, string attributeName, int id) =>
        root.ChildElements.FirstOrDefault(element => element.LocalName == elementName
            && element.NamespaceUri == WordNamespace
            && ReadWordAttributeInt(element, attributeName) == id);

    private static bool IsHeadingStyle(OpenXmlElement element) =>
        element is ParagraphStyleId style && style.Val?.Value?.StartsWith("Heading", StringComparison.OrdinalIgnoreCase) == true;

    private static bool IsRelationshipReference(OpenXmlAttribute attribute) =>
        string.Equals(attribute.NamespaceUri, RelationshipNamespace, StringComparison.Ordinal)
        && attribute.LocalName is "id" or "embed" or "link";

    private static int? ReadWordAttributeInt(OpenXmlElement? element, string localName)
    {
        var value = element?.GetAttributes().FirstOrDefault(attribute => attribute.NamespaceUri == WordNamespace && attribute.LocalName == localName).Value;
        return int.TryParse(value, out var number) ? number : null;
    }

    private static void SetWordAttribute(OpenXmlElement element, string localName, int value) =>
        element.SetAttribute(new OpenXmlAttribute("w", localName, WordNamespace, value.ToString(System.Globalization.CultureInfo.InvariantCulture)));

    private static void SetNoNamespaceAttribute(OpenXmlElement element, string localName, uint value) =>
        element.SetAttribute(new OpenXmlAttribute(string.Empty, localName, string.Empty, value.ToString(System.Globalization.CultureInfo.InvariantCulture)));

    private static void SetNoNamespaceAttribute(OpenXmlElement element, string localName, long value) =>
        element.SetAttribute(new OpenXmlAttribute(string.Empty, localName, string.Empty, value.ToString(System.Globalization.CultureInfo.InvariantCulture)));

    private static long? ReadLongAttribute(OpenXmlElement element, string localName)
    {
        var value = element.GetAttributes().FirstOrDefault(attribute => attribute.NamespaceUri.Length == 0 && attribute.LocalName == localName).Value;
        return long.TryParse(value, out var result) ? result : null;
    }

    private static string AllocateBookmarkName(string sourceName, ISet<string> taken)
    {
        if (!taken.Contains(sourceName)) return sourceName;
        for (var suffix = 2; ; suffix++)
        {
            var suffixText = $"_hkr{suffix}";
            var baseLength = Math.Max(1, 40 - suffixText.Length);
            var candidate = $"{sourceName[..Math.Min(sourceName.Length, baseLength)]}{suffixText}";
            if (!taken.Contains(candidate)) return candidate;
        }
    }

    private sealed class StyleMap
    {
        private readonly IReadOnlyDictionary<(string Id, string Type), string> _styleIds;
        private readonly ISet<(string Id, string Type)> _fallbackKeys;

        private StyleMap(
            IReadOnlyDictionary<(string Id, string Type), string> styleIds,
            ISet<(string Id, string Type)> fallbackKeys)
        {
            _styleIds = styleIds;
            _fallbackKeys = fallbackKeys;
        }

        public static StyleMap Create(MainDocumentPart source, MainDocumentPart destination)
        {
            // Reading destination styles as raw XML avoids an unnecessary
            // styles.xml rewrite on a preservation-sensitive output package.
            var destinationStyles = ReadDestinationStyleCatalog(destination);
            var destinationByKey = destinationStyles.ToDictionary(style => (style.Id, style.Type), style => style.Id);
            var destinationByName = destinationStyles
                .Where(style => style.Name is not null)
                .GroupBy(style => NameKey(style.Name!, style.Type), StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First().Id, StringComparer.Ordinal);
            var destinationDefaults = destinationStyles
                .Where(style => style.IsDefault)
                .GroupBy(style => style.Type, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First().Id, StringComparer.Ordinal);
            var mapped = new Dictionary<(string Id, string Type), string>();
            var fallbacks = new HashSet<(string Id, string Type)>();
            foreach (var sourceStyle in source.StyleDefinitionsPart?.Styles?.Elements<Style>() ?? [])
            {
                var sourceId = sourceStyle.StyleId?.Value;
                var sourceType = sourceStyle.Type?.InnerText ?? string.Empty;
                if (string.IsNullOrWhiteSpace(sourceId)) continue;
                var key = (sourceId, sourceType);
                if (destinationByKey.TryGetValue(key, out var sameId)) mapped[key] = sameId;
                else if (sourceStyle.StyleName?.Val?.Value is { } name && destinationByName.TryGetValue(NameKey(name, sourceType), out var sameName)) mapped[key] = sameName;
                else if (sourceType is "paragraph" or "table" or "character" && destinationDefaults.TryGetValue(sourceType, out var fallback))
                {
                    mapped[key] = fallback;
                    fallbacks.Add(key);
                }
            }
            return new StyleMap(mapped, fallbacks);
        }

        public IEnumerable<string> FindMissingReferences(IEnumerable<OpenXmlElement> roots) =>
            FindStyleReferences(roots)
                .Where(reference => !_styleIds.ContainsKey(reference.Key))
                .Select(reference => reference.Id)
                .Distinct(StringComparer.Ordinal)
                .OrderBy(id => id, StringComparer.Ordinal);

        public bool HasMappedReferences(IEnumerable<OpenXmlElement> roots) =>
            FindStyleReferences(roots).Any(reference => _styleIds.ContainsKey(reference.Key));

        public bool HasFallbackReferences(IEnumerable<OpenXmlElement> roots) =>
            FindStyleReferences(roots).Any(reference => _fallbackKeys.Contains(reference.Key));

        public void Apply(OpenXmlElement root)
        {
            foreach (var reference in FindStyleReferences([root]))
            {
                if (!_styleIds.TryGetValue(reference.Key, out var destinationId))
                    throw new InvalidOperationException($"Missing style map for '{reference.Id}'.");
                reference.SetValue(destinationId);
            }
        }

        private static IEnumerable<StyleReference> FindStyleReferences(IEnumerable<OpenXmlElement> roots)
        {
            foreach (var element in AllElements(roots))
            {
                switch (element)
                {
                    case ParagraphStyleId paragraph when !string.IsNullOrWhiteSpace(paragraph.Val?.Value):
                        yield return new StyleReference(paragraph, paragraph.Val!.Value!, "paragraph");
                        break;
                    case RunStyle run when !string.IsNullOrWhiteSpace(run.Val?.Value):
                        yield return new StyleReference(run, run.Val!.Value!, "character");
                        break;
                    case TableStyle table when !string.IsNullOrWhiteSpace(table.Val?.Value):
                        yield return new StyleReference(table, table.Val!.Value!, "table");
                        break;
                }
            }
        }

        private static IReadOnlyList<StyleDefinition> ReadDestinationStyleCatalog(MainDocumentPart destination)
        {
            var stylesPart = destination.StyleDefinitionsPart;
            if (stylesPart is null) return [];
            using var stream = stylesPart.GetStream(FileMode.Open, FileAccess.Read);
            var xml = XDocument.Load(stream);
            XNamespace word = WordNamespace;
            return xml.Root?
                .Elements(word + "style")
                .Select(style => new StyleDefinition(
                    (string?)style.Attribute(word + "styleId") ?? string.Empty,
                    (string?)style.Element(word + "name")?.Attribute(word + "val"),
                    (string?)style.Attribute(word + "type") ?? string.Empty,
                    ((string?)style.Attribute(word + "default")) is "1" or "true" or "True"))
                .Where(style => !string.IsNullOrWhiteSpace(style.Id))
                .ToArray() ?? [];
        }

        private static string NameKey(string name, string type) => $"{type}\u001f{name}".ToUpperInvariant();

        private sealed record StyleDefinition(string Id, string? Name, string Type, bool IsDefault);

        private sealed class StyleReference
        {
            public StyleReference(ParagraphStyleId element, string id, string type) => (Paragraph, Id, Type) = (element, id, type);
            public StyleReference(RunStyle element, string id, string type) => (Run, Id, Type) = (element, id, type);
            public StyleReference(TableStyle element, string id, string type) => (Table, Id, Type) = (element, id, type);

            public ParagraphStyleId? Paragraph { get; }
            public RunStyle? Run { get; }
            public TableStyle? Table { get; }
            public string Id { get; }
            public string Type { get; }
            public (string Id, string Type) Key => (Id, Type);
            public void SetValue(string value)
            {
                if (Paragraph is not null) Paragraph.Val = value;
                else if (Run is not null) Run.Val = value;
                else if (Table is not null) Table.Val = value;
                else throw new InvalidOperationException("Style reference has no element.");
            }
        }
    }

    public sealed record ExistingPackageIds(
        IReadOnlyCollection<uint> DrawingDocPropertyIds,
        IReadOnlyCollection<uint> BookmarkIds);

    public sealed record FragmentImportAnalysis(
        IReadOnlyCollection<string> ImageRelationshipIds,
        IReadOnlyCollection<string> HyperlinkRelationshipIds,
        IReadOnlyCollection<int> NumberingIds,
        IReadOnlyCollection<BookmarkDefinition> SourceBookmarks,
        IReadOnlyList<ImportGap> Gaps,
        IReadOnlyList<string> SupportedFeatures,
        IReadOnlyList<string> InitialPotentiallyLossyFeatures)
    {
        private readonly HashSet<string> _runtimePotentiallyLossy = new(StringComparer.Ordinal);
        public bool HasBlockingGaps => Gaps.Any(gap => gap.Blocking);
        public bool RequiresRelationshipChanges => ImageRelationshipIds.Count > 0 || HyperlinkRelationshipIds.Count > 0;
        public bool RequiresNumberingChanges => NumberingIds.Count > 0;
        public IReadOnlyList<string> PotentiallyLossyFeatures => InitialPotentiallyLossyFeatures
            .Concat(_runtimePotentiallyLossy)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        public void AddPotentiallyLossy(string feature) => _runtimePotentiallyLossy.Add(feature);
    }

    public sealed record BookmarkDefinition(string Id, string? Name);

    private sealed record BookmarkMaps(
        IReadOnlyDictionary<string, uint> Ids,
        IReadOnlyDictionary<string, string> Names);

    private sealed class NumericIdAllocator
    {
        private readonly HashSet<uint> _used;
        private uint _next;

        public NumericIdAllocator(IEnumerable<uint> used)
        {
            _used = used.ToHashSet();
            _next = _used.Count == 0 ? 1 : _used.Max() == uint.MaxValue ? throw new InvalidDataException("No numeric IDs remain.") : _used.Max() + 1;
        }

        public uint Next()
        {
            while (_used.Contains(_next))
            {
                if (_next == uint.MaxValue) throw new InvalidDataException("No numeric IDs remain.");
                _next++;
            }
            var next = _next;
            _used.Add(next);
            if (_next != uint.MaxValue) _next++;
            return next;
        }
    }
}
