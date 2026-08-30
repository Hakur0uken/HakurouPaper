namespace Hakurou.WordTemplatePoc.Models;

public sealed record TemplateInspection(
    string TemplatePath,
    int OfficeImoSectionCount,
    IReadOnlyList<SectionInfo> Sections,
    IReadOnlyList<StyleInfo> Styles,
    IReadOnlyList<BookmarkInfo> Bookmarks,
    IReadOnlyList<ContentControlInfo> ContentControls,
    IReadOnlyList<AnchorInfo> Anchors,
    IReadOnlyList<HeaderFooterInfo> Headers,
    IReadOnlyList<HeaderFooterInfo> Footers,
    IReadOnlyList<string> Logs);

public sealed record SectionInfo(
    int Index,
    string BreakType,
    int Columns,
    int? PageWidth,
    int? PageHeight,
    PageMarginsInfo Margins,
    int? HeaderDistance,
    int? FooterDistance);

public sealed record PageMarginsInfo(int? Top, int? Bottom, int? Left, int? Right, int? Gutter);

public sealed record StyleInfo(string Id, string? Name, string? Type);

public sealed record BookmarkInfo(string Name, string? Id);

public sealed record ContentControlInfo(string? Tag, string? Title, string Kind);

/// <summary>
/// A deterministic template target description. <see cref="Kind"/> states
/// whether it is an SDT or bookmark; <see cref="Level"/> tells callers
/// whether the target can contain block-level Word elements.
/// </summary>
public sealed record AnchorInfo(
    string Name,
    string Kind,
    string Level,
    int Occurrences,
    bool IsValid,
    string? Issue = null);

public sealed record ImportGap(
    string Code,
    string Feature,
    string Detail,
    bool Blocking = true);

public sealed record CapabilityReport(
    IReadOnlyList<string> Supported,
    IReadOnlyList<string> Preserved,
    IReadOnlyList<string> Unsupported,
    IReadOnlyList<string> PotentiallyLossy);

public sealed record HeaderFooterInfo(string PartUri, string ContentType);

public sealed record MappingPlan(
    string Title = "HAKUROU_TITLE",
    string Abstract = "HAKUROU_ABSTRACT",
    string Body = "HAKUROU_BODY");

public sealed record SemanticDocument(string? Title, string? Abstract, string BodyMarkdown, int BodyBlockCount);

public sealed record RenderTemplateRequest(
    string TemplatePath,
    string OutputPath,
    string Markdown,
    string PandocPath,
    string WorkingDirectory,
    MappingPlan? Mapping = null);

public sealed record PackagePartChange(string Path, long Length, string Sha256);

public sealed record PackageComparison(
    IReadOnlyList<PackagePartChange> ChangedParts,
    IReadOnlyList<PackagePartChange> AddedParts,
    IReadOnlyList<PackagePartChange> RemovedParts);

public sealed record DuplicateIdFinding(
    string Kind,
    string Value,
    IReadOnlyList<string> Locations);

public sealed record RelationshipValidation(
    bool IsComplete,
    IReadOnlyList<string> DanglingRelationships);

/// <summary>
/// A canonical snapshot of an original <c>w:sectPr</c>.  It deliberately
/// covers the whole element, including properties this PoC does not interpret
/// (header/footer references, margins, grids, and vendor extensions).
/// </summary>
public sealed record SectionStructuralSnapshot(int Index, string CanonicalXml);

public sealed record WordValidationReport(
    bool OpenXmlValidatorPassed,
    IReadOnlyList<string> OpenXmlValidationErrors,
    RelationshipValidation Relationships,
    IReadOnlyList<DuplicateIdFinding> DuplicateIds,
    int SectionCount,
    IReadOnlyList<int> Columns,
    int SectPrCount,
    IReadOnlyList<SectionStructuralSnapshot> SectionSnapshots,
    IReadOnlyList<string> SectionPreservationErrors,
    PackageComparison PackageChanges,
    IReadOnlyList<string> UnexpectedChangedParts,
    bool Passed);

public sealed record RenderTemplateResult(
    bool Success,
    string? OutputPath,
    SemanticDocument? Document,
    IReadOnlyList<string> UnresolvedTargets,
    PackageComparison? Preservation,
    IReadOnlyList<string> ValidationErrors,
    IReadOnlyList<string> Logs,
    string? Error = null,
    WordValidationReport? ValidationReport = null,
    string? ValidationReportPath = null,
    CapabilityReport? Capabilities = null,
    IReadOnlyList<ImportGap>? Gaps = null,
    IReadOnlyList<string>? AnchorIssues = null);

public sealed record RoundtripResult(
    bool Success,
    string OutputPath,
    PackageComparison Preservation,
    IReadOnlyList<string> Logs,
    string? Error = null);

public sealed record CliFailure(bool Success, string Error, IReadOnlyList<string>? Logs = null);
