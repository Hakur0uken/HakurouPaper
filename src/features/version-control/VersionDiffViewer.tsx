import { useEffect, useMemo, useState } from "react";
import type { UiText } from "../../i18n";
import { platform, type DiffHunk, type DiffLine, type FileDiff, type RevisionDescriptor, type VersionChange, type VersionComparison } from "../../platform";
import type { FeatureDocumentContext } from "../registry";

type DiffSideRow = { before?: DiffLine; after?: DiffLine };
type ComparisonState = { kind: "loading" } | { kind: "ready"; comparison: VersionComparison } | { kind: "error"; message: string };
type FileDiffState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; diff: FileDiff } | { kind: "error"; message: string };

function filename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function changeLabel(change: VersionChange, text: UiText) {
  switch (change.kind) {
    case "added":
    case "untracked": return text.versionChangeAdded;
    case "deleted": return text.versionChangeDeleted;
    case "renamed": return text.versionChangeRenamed;
    default: return text.versionChangeModified;
  }
}

function sideBySideRows(hunk: DiffHunk): DiffSideRow[] {
  const rows: DiffSideRow[] = [];
  for (let index = 0; index < hunk.lines.length;) {
    const line = hunk.lines[index]!;
    if (line.kind === "context") {
      rows.push({ before: line, after: line });
      index += 1;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < hunk.lines.length && hunk.lines[index]!.kind !== "context") {
      const changed = hunk.lines[index]!;
      if (changed.kind === "removed") removed.push(changed);
      if (changed.kind === "added") added.push(changed);
      index += 1;
    }
    const rowCount = Math.max(removed.length, added.length);
    for (let row = 0; row < rowCount; row += 1) rows.push({ before: removed[row], after: added[row] });
  }
  return rows;
}

function DiffCell({ line, side }: { line?: DiffLine; side: "before" | "after" }) {
  if (!line) return <div className="diff-cell is-empty" />;
  const kind = line.kind === "context" ? "context" : side === "before" ? "removed" : "added";
  const lineNumber = side === "before" ? line.oldLineNumber : line.newLineNumber;
  return <div className={`diff-cell is-${kind}`}>
    <span className="diff-line-number">{lineNumber ?? ""}</span>
    <code>{line.content}</code>
  </div>;
}

function revisionName(revision: RevisionDescriptor, text: UiText, side: "base" | "target") {
  if (revision.kind === "currentDocument") return text.versionCurrentDocument;
  if (revision.kind === "empty") return text.versionNoSavedRevision;
  return revision.title || revision.shortId || (side === "base" ? text.versionPreviousVersion : text.versionThisVersion);
}

function revisionRole(revision: RevisionDescriptor, text: UiText, side: "base" | "target") {
  if (revision.kind === "currentDocument") return text.versionCurrentDocument;
  if (revision.kind === "empty") return text.versionPreviousVersion;
  return side === "base" ? text.versionPreviousVersion : text.versionThisVersion;
}

function RevisionCard({ revision, side, text }: { revision: RevisionDescriptor; side: "base" | "target"; text: UiText }) {
  return <div className={`version-revision-card is-${revision.kind}`}>
    <span>{revisionRole(revision, text, side)}</span>
    <strong>{revisionName(revision, text, side)}</strong>
    {revision.kind === "version" && <div className="version-revision-details">
      {revision.authorName && <span>{revision.authorName}</span>}
      {revision.timestamp && <span>{new Date(revision.timestamp).toLocaleString()}</span>}
      {revision.shortId && <code title={revision.id}>{revision.shortId}</code>}
    </div>}
    {revision.kind === "currentDocument" && <div className="version-revision-details"><span>{text.versionNotCreatedYet}</span></div>}
  </div>;
}

export function VersionDiffViewer({ document, initialPath, versionId, text, onClose, onRestoreVersion }: { document: FeatureDocumentContext; initialPath: string | null; versionId: string | null; text: UiText; onClose: () => void; onRestoreVersion: (targetCommitId: string, targetTitle: string) => void }) {
  const [comparisonState, setComparisonState] = useState<ComparisonState>({ kind: "loading" });
  const [diffState, setDiffState] = useState<FileDiffState>({ kind: "idle" });
  const [selectedPath, setSelectedPath] = useState<string | null>(initialPath);
  const [showInternalFiles, setShowInternalFiles] = useState(false);

  useEffect(() => {
    if (!document.path) return;
    let disposed = false;
    setComparisonState({ kind: "loading" });
    void platform.versionControl.getComparison({ documentPath: document.path, assetFolder: document.assetFolder, versionId })
      .then((comparison) => { if (!disposed) setComparisonState({ kind: "ready", comparison }); })
      .catch((error) => { if (!disposed) setComparisonState({ kind: "error", message: String(error) }); });
    return () => { disposed = true; };
  }, [document.assetFolder, document.path, versionId]);

  useEffect(() => {
    setSelectedPath(initialPath);
  }, [initialPath, versionId]);

  const visibleChanges = useMemo(() => comparisonState.kind === "ready"
    ? comparisonState.comparison.changes.filter((item) => showInternalFiles || item.resourceKind !== "metadata")
    : [], [comparisonState, showInternalFiles]);

  const selectedChange = useMemo(() => visibleChanges.find((item) => item.path === selectedPath) ?? null, [selectedPath, visibleChanges]);

  useEffect(() => {
    if (comparisonState.kind !== "ready") return;
    const preferred = comparisonState.comparison.changes.find((item) => item.isDocument) ?? visibleChanges[0] ?? null;
    if (!selectedChange && preferred) setSelectedPath(preferred.path);
  }, [comparisonState, selectedChange, visibleChanges]);

  useEffect(() => {
    if (!document.path || !selectedChange) {
      setDiffState({ kind: "idle" });
      return;
    }
    let disposed = false;
    setDiffState({ kind: "loading" });
    void platform.versionControl.getDiff({ documentPath: document.path, assetFolder: document.assetFolder, path: selectedChange.path, versionId })
      .then((diff) => { if (!disposed) setDiffState({ kind: "ready", diff }); })
      .catch((error) => { if (!disposed) setDiffState({ kind: "error", message: String(error) }); });
    return () => { disposed = true; };
  }, [document.assetFolder, document.path, selectedChange, versionId]);

  const displayedPath = selectedChange && selectedChange.kind === "renamed" && selectedChange.oldPath
    ? `${filename(selectedChange.oldPath)} → ${filename(selectedChange.path)}`
    : selectedChange ? filename(selectedChange.path) : "";
  const comparison = comparisonState.kind === "ready" ? comparisonState.comparison : null;

  return <section className="version-diff-viewer" aria-label={text.versionComparisonTitle}>
    <header className="version-diff-header">
      <div>
        <h1>{text.versionComparisonTitle} <small>{text.versionAdvancedMode}</small></h1>
        {comparison && <>
          <div className="version-revision-comparison">
            <RevisionCard revision={comparison.baseRevision} side="base" text={text} />
            <span aria-hidden="true">↔</span>
            <RevisionCard revision={comparison.targetRevision} side="target" text={text} />
          </div>
          <p className="version-comparison-summary">{text.versionFilesChanged(comparison.summary.changedFiles)} · {text.versionLineSummary(comparison.summary.addedLines, comparison.summary.removedLines)}</p>
        </>}
      </div>
      <div className="version-diff-header-actions">
        {versionId && comparison?.targetRevision.kind === "version" && <button type="button" className="is-primary" onClick={() => onRestoreVersion(versionId, comparison.targetRevision.title ?? comparison.targetRevision.shortId ?? text.versionThisVersion)}>{text.versionRestoreThis}</button>}
        <button type="button" onClick={onClose}>{text.versionDiffClose}</button>
      </div>
    </header>

    {comparisonState.kind === "loading" && <p className="version-diff-message">{text.versionDiffLoading}</p>}
    {comparisonState.kind === "error" && <p className="version-diff-message is-error">{comparisonState.message}</p>}
    {comparison && <>
      <section className="version-file-selector" aria-label={text.versionChangedFiles}>
        <div className="version-file-selector-heading">
          <h2>{text.versionChangedFiles}</h2>
          <label><input type="checkbox" checked={showInternalFiles} onChange={(event) => setShowInternalFiles(event.target.checked)} /> {text.versionShowInternalFiles}</label>
        </div>
        <div className="version-file-list">
          {visibleChanges.map((item) => <button type="button" key={item.path} className={item.path === selectedPath ? "is-selected" : ""} onClick={() => setSelectedPath(item.path)}>
            <span className={`version-file-symbol is-${item.kind}`} aria-hidden="true">●</span>
            <span><strong>{item.kind === "renamed" && item.oldPath ? <>{filename(item.oldPath)} → {filename(item.path)}</> : filename(item.path)}</strong><small>{changeLabel(item, text)}</small></span>
          </button>)}
        </div>
      </section>

      {selectedChange && <div className="version-diff-file-heading"><strong>{displayedPath}</strong><span>{changeLabel(selectedChange, text)}</span></div>}
      {diffState.kind === "idle" && <p className="version-diff-message">{text.versionNoChanges}</p>}
      {diffState.kind === "loading" && <p className="version-diff-message">{text.versionDiffLoading}</p>}
      {diffState.kind === "error" && <p className="version-diff-message is-error">{diffState.message}</p>}
      {diffState.kind === "ready" && diffState.diff.kind === "binary" && <div className="version-diff-message is-binary"><strong>{filename(diffState.diff.path)}</strong><p>{text.versionDiffBinary}</p></div>}
      {diffState.kind === "ready" && diffState.diff.kind === "text" && <div className="version-diff-text">
        <div className="version-diff-column-headings"><span>{revisionRole(comparison.baseRevision, text, "base")}</span><span>{revisionRole(comparison.targetRevision, text, "target")}</span></div>
        {diffState.diff.hunks.length === 0
          ? <p className="version-diff-message">{text.versionDiffNoTextChanges}</p>
          : diffState.diff.hunks.map((hunk, hunkIndex) => <section className="diff-hunk" key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
            <div className="diff-hunk-heading">−{hunk.oldStart},{hunk.oldLines} ＋{hunk.newStart},{hunk.newLines}</div>
            <div className="diff-hunk-rows">
              {sideBySideRows(hunk).map((row, rowIndex) => <div className="diff-side-by-side-row" key={rowIndex}>
                <DiffCell line={row.before} side="before" />
                <DiffCell line={row.after} side="after" />
              </div>)}
            </div>
          </section>)}
      </div>}
    </>}
  </section>;
}
