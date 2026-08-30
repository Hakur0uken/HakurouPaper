# Hakurou Word Template PoC

This is an isolated .NET 8 experiment. It deliberately leaves the existing
Pandoc provider untouched.

## Delivery boundary

HakurouPaper has two deliberately different Word delivery paths:

- **General Word Export** is content-driven: Markdown is rendered by Pandoc
  into an editable DOCX. Its default **Current document style** uses an
  internally generated reference DOCX with HakurouPaper's compact Word style
  vocabulary (title, headings, body, quote, caption, code, list and table).
  A user-selected Word reference document may replace that internal reference.
  Formula delivery (native Word equations or MathType) remains independent of
  the layout source.
- **Precise Word Template (Experimental)** is template-driven: an existing
  DOCX is analyzed for explicit semantic targets and then locally patched by
  this deterministic engine. It preserves the template package and makes no
  automatic content-location or style-mapping guesses.

Pandoc therefore generates the normal editable Word document; the experimental
engine injects into an explicitly mapped template and validates the resulting
local DOCX package. The UI may describe a recommended AI/Agent-assisted
workflow, but this helper does not discover, invoke, or depend on an external
Agent, Skill, or CLI.

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

## Stage 3 hardening guarantees

The body anchor is resolved to its real Word section: a paragraph `w:sectPr`
terminates the preceding section, rather than starting the following one. The
exporter derives usable page width from page size, left/right margins and
gutter, then derives equal or explicit unequal column widths. Inline pictures
are only downscaled (both `wp:extent` and DrawingML transform extent) to the
narrowest applicable flowing column. Simple tables may be AutoFit/scaled; an
obviously too-wide table is still exported but is reported as
`potentiallyLossy: table too wide for current column`. It never rotates or
spans tables automatically.

Text bookmarks replace only the direct inline range between their matching
start/end nodes, so visible prefix and suffix runs survive. A body bookmark is
accepted only when it is a dedicated paragraph containing paragraph properties,
a matching bookmark pair, and a simple placeholder run; inline or mixed-content
body bookmarks fail with `incompatibleAnchor`.

Rendering is transactional: the template is copied to a unique temporary DOCX
in the output directory, patched, package-validated and only then renamed over
the requested final output. A failure removes temporary files and never creates
or overwrites the final DOCX. The adjacent developer report uses the same
publication rule and is named `<output-name>.validation.json`.

Validation requires every XML `r:id`, `r:embed`, and `r:link` reference to have
its source `.rels` part, relationship ID and (for internal relationships)
target part. The baseline retains a canonical full snapshot of every original
`w:sectPr`; margin, header/footer reference, or unknown section-property
changes therefore fail validation even though `word/document.xml` is the one
permitted edited part.

Capability reporting is deliberately semantic: `Supported` means the importer
deterministically creates or modifies it, `Preserved` means the feature really
exists in the template and stayed untouched, `Unsupported` is a detected unsafe
dependency, and `PotentiallyLossy` is an explicit risk. Template sections,
columns, headers, and footers are preservation claims, never advertised as
importer-created features.

`run-regression` builds seven deliberately small templates (single-column,
continuous columns, sections with headers/footers, existing numbering,
existing image relationship, content controls, and bookmarks). It injects the
same rich fixture twice into each one and also proves inline, duplicate, and
malformed anchors are rejected. Stage 3 additionally verifies wide/narrow
images, three and unequal columns, wide-table warnings, inline bookmark prefix
and suffix preservation, non-dedicated body bookmark rejection, transactional
failure behaviour, missing source relationship parts, and header/margin section
snapshot failures. All generated files stay in the supplied output directory.

## MathType compatibility note (developer-only)

This PoC does not recreate MathType/OLE. To check a template that is later
passed to the existing MathType path, export it with this helper first, run the
existing MathType conversion flow, then inspect the resulting package for its
original section snapshots, header/footer parts and relationship IDs, embedded
image relationships, and numbering IDs. This is a manual developer check: the
Windows-only MathType pipeline is not automated by `run-regression`, so absence
of an installed MathType environment remains a reported verification limitation
rather than a claim of compatibility.

`validate-with-word` is intentionally an explicit developer command and is not
called by the Tauri bridge or normal application export. It skips when Word is
not installed.
