# Hakurou Word Template PoC

This is an isolated .NET 8 experiment. It deliberately leaves the existing
Pandoc provider untouched.

Commands emit JSON on standard output:

```powershell
dotnet run --project .\Hakurou.WordTemplatePoc.csproj -- inspect-template template.docx --report template-analysis.json
dotnet run --project .\Hakurou.WordTemplatePoc.csproj -- roundtrip-template template.docx roundtrip.docx
Get-Content request.json | dotnet run --project .\Hakurou.WordTemplatePoc.csproj -- render-template
dotnet run --project .\Hakurou.WordTemplatePoc.csproj -- run-regression ..\..\pandoc\pandoc.exe ..\..\test\word-template-poc\multi-resource.md $env:TEMP\hakurou-word-template-regression
# Developer-only: opens a generated file and SaveAs2 copies it through Word.
dotnet run --project .\Hakurou.WordTemplatePoc.csproj -- validate-with-word generated.docx word-saveas-check.docx
```

`render-template` expects `templatePath`, `outputPath`, `markdown`,
`pandocPath`, and `workingDirectory`. It recognizes only the deterministic
targets `HAKUROU_TITLE`, `HAKUROU_ABSTRACT`, and `HAKUROU_BODY`, first as a
content-control tag and then as a bookmark name. It reports unresolved targets
instead of inferring locations.

OfficeIMO is used to prove that the template can be loaded and to run the
explicit save round-trip experiment. Open XML SDK performs the package
inspection and preservation-sensitive, local mutation. Body content comes from
Pandoc's DOCX fragment, with its `w:sectPr` removed before insertion.

## Stage 2 importer guarantees

Before copying the template, `DocxFragmentImporter` analyzes only the body
nodes that will be inserted. It handles embedded image and external hyperlink
relationships, Word drawing `wp:docPr` IDs, fragment bookmark IDs/names and
internal bookmark links, mapped style references, and the `w:num` /
`w:abstractNum` closure required by ordered and bullet lists. Numbering is
appended with fresh IDs; the template's `numbering.xml` is never replaced.

Unsupported footnotes, endnotes, comments, OLE, charts, SmartArt, unknown
relationship types, linked images, and dangling internal hyperlinks are
reported as blocking gaps before an output file is created. Generic fallback
to a template default paragraph/table/character style is reported as
`potentiallyLossy`, not silently treated as a perfect style match.

Every successful export writes `word-validation-report.json` beside its output.
It contains Open XML schema results, relationship checks, duplicate Word IDs,
section/column counts, changed parts, and changes outside the allowlist. The
export fails if schema, relationships, IDs, or package preservation fails.

`run-regression` builds seven deliberately small templates (single-column,
continuous columns, sections with headers/footers, existing numbering,
existing image relationship, content controls, and bookmarks). It injects the
same rich fixture twice into each one and also proves inline, duplicate, and
malformed anchors are rejected. All generated files stay in the supplied
output directory.

`validate-with-word` is intentionally an explicit developer command and is not
called by the Tauri bridge or normal application export. It skips when Word is
not installed.
