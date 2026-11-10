import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { UiText } from "../../i18n";
import { platform, type RevisionDescriptor, type RevisionTextSnapshot, type VersionRecord } from "../../platform";
import type { RemoteMergeFileVersions, RemoteMergeResolution, RemoteMergeReview, RemoteMergeVersion } from "../../platform/remoteMergeTypes";
import type { FeatureDocumentContext } from "../registry";
import { RenderedRevisionViewer, type DirectRevisionComparison } from "../version-control/RenderedRevisionViewer";
import { sequenceChanges } from "../../collaboration/sequenceChanges";
import { MergeResolutionEditor } from "./MergeResolutionEditor";
import type { RemoteMergeText } from "./mergeText";
import "./remoteMerge.css";

function SourceChanges({ before, after, text }: { before: RemoteMergeVersion; after: RemoteMergeVersion; text: RemoteMergeText }) {
  const lines = useMemo(() => {
    const split = (value: string | null) => value?.match(/[^\n]*\n|[^\n]+$/g) ?? [];
    const old = split(before.content), next = split(after.content), changes = sequenceChanges(old, next);
    const result: Array<{ kind: string; value: string }> = []; let previous = 0;
    for (const change of changes) {
      if (change.from - previous > 6) result.push({ kind: "gap", value: "…\n" });
      old.slice(Math.max(previous, change.from - 3), change.from).forEach(value => result.push({ kind: "context", value }));
      old.slice(change.from, change.to).forEach(value => result.push({ kind: "removed", value }));
      change.insert.forEach(value => result.push({ kind: "added", value }));
      previous = change.to;
    }
    if (changes.length) old.slice(previous, previous + 3).forEach(value => result.push({ kind: "context", value }));
    return result;
  }, [before.content, after.content]);
  if (before.content === null && after.content === null) return <p>{text.noImage}</p>;
  return lines.length ? <pre className="remote-source-diff">{lines.map((line, index) => <span key={index} className={`is-${line.kind}`}>{line.kind === "added" ? "+ " : line.kind === "removed" ? "− " : "  "}{line.value.endsWith("\n") ? line.value : line.value + "\n"}</span>)}</pre> : <p>{text.same}</p>;
}

function VersionPane({ version, label, text }: { version: RemoteMergeVersion; label: string; text: RemoteMergeText }) {
  return <section><h3>{label}</h3>{version.kind === "missing" ? <p>{text.missing}</p> : <>
    <p>{version.size} {text.bytes} · <code>{version.hash?.slice(0, 12)}</code></p>
    {version.preview ? <img src={version.preview} alt={label} /> : version.kind === "link" ? <pre>{version.content}</pre> : <p>{text[version.kind === "text" ? "binary" : version.kind]}</p>}
  </>}</section>;
}
function descriptor(record: VersionRecord, title: string): RevisionDescriptor { return { kind: "version", id: record.id, shortId: record.shortId, title, timestamp: record.timestamp, authorName: record.authorName, authorEmail: record.authorEmail }; }
function snapshot(version: RemoteMergeVersion, revision: RevisionDescriptor): RevisionTextSnapshot { return { revision: version.kind === "missing" ? { kind: "empty", title: revision.title } : revision, markdown: version.content ?? "", metadata: version.metadata ?? undefined, assets: version.assets }; }

function FileReview({ review, path, versions, document, text, onResolution, resolution }: { review: RemoteMergeReview; path: string; versions: RemoteMergeFileVersions; document: FeatureDocumentContext; text: UiText; resolution?: RemoteMergeResolution; onResolution: (value: RemoteMergeResolution | null) => void }) {
  const t = text.remoteSync.merge;
  const conflict = review.conflicts.find(group => group.paths.includes(path));
  const [pair, setPair] = useState<"both" | "local" | "remote">("both");
  const [mode, setMode] = useState<"body" | "source" | "resolve">(conflict ? "resolve" : /\.(md|markdown|mdx)$/i.test(path) ? "body" : "source");
  const left = pair === "both" ? versions.local : versions.base, right = pair === "local" ? versions.local : versions.remote;
  const markdown = /\.(md|markdown|mdx)$/i.test(path) && [left, right].every(v => v.kind === "missing" || v.kind === "text");
  const context = useMemo<FeatureDocumentContext>(() => ({ ...document, path: `${review.repositoryRoot}/${path}`, title: path, content: right.content ?? "", sidecarContent: right.metadata ?? "{}", assetFolder: null, assets: [], isDirty: false }), [document, path, review.repositoryRoot, right.content, right.metadata]);
  const directComparison = useMemo<DirectRevisionComparison>(() => {
    const before = snapshot(left, descriptor(pair === "both" ? review.local : review.base, pair === "both" ? t.local : t.base));
    const after = snapshot(right, descriptor(pair === "local" ? review.local : review.remote, pair === "local" ? t.local : t.remote));
    return { before, after, readOnly: true, comparison: { baseRevision: before.revision, targetRevision: after.revision, changes: [], summary: { changedFiles: 1, addedLines: 0, removedLines: 0, internalFiles: 0 } },
      loadAsset: (revisionId, assetPath) => platform.remoteGit.readMergeAsset({ planId: review.id, revisionId, documentPath: path, assetPath }),
    };
  }, [left, right, pair, review, path, t]);
  return <div className="remote-file-review">
    <header><strong title={path}>{path}</strong><label>{t.pair}<select value={pair} onChange={event => setPair(event.target.value as typeof pair)}><option value="both">{t.pairBoth}</option><option value="local">{t.pairLocal}</option><option value="remote">{t.pairRemote}</option></select></label></header>
    <nav className="remote-review-modes" aria-label={t.pair}>
      {markdown && <button type="button" aria-pressed={mode === "body"} onClick={() => setMode("body")}>{t.body}</button>}
      <button type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>{t.source}</button>
      {conflict && <button type="button" aria-pressed={mode === "resolve"} onClick={() => setMode("resolve")}>{t.resolve}</button>}
    </nav>
    {mode === "body" && markdown ? <RenderedRevisionViewer key={`${path}:${pair}`} document={context} versionId={null} text={text} directComparison={directComparison} onClose={() => setMode("source")} onOpenAdvanced={() => setMode("source")} onRestoreVersion={() => {}} /> : <div className="remote-file-content">
      {mode === "resolve" && conflict ? <MergeResolutionEditor conflict={conflict} path={path} versions={versions} current={resolution} onChange={onResolution} text={t} /> : [left, right].every(v => v.kind === "text" || v.kind === "missing") ? <SourceChanges before={left} after={right} text={t} /> : <div className="remote-file-sides"><VersionPane version={left} label={pair === "both" ? t.local : t.base} text={t} /><VersionPane version={right} label={pair === "local" ? t.local : t.remote} text={t} /></div>}
    </div>}
  </div>;
}

export function RemoteMergeDialog({ review, document, text, blocked, onClose, onApply }: { review: RemoteMergeReview; document: FeatureDocumentContext; text: UiText; blocked: boolean; onClose: () => void; onApply: (resolutions: RemoteMergeResolution[], message: string) => Promise<void> }) {
  const t = text.remoteSync.merge;
  const [selected, setSelected] = useState(review.files.find(file => file.conflictId)?.path ?? review.files[0]?.path ?? "");
  const [versions, setVersions] = useState<{ path: string; data: RemoteMergeFileVersions } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, RemoteMergeResolution>>({});
  const [message, setMessage] = useState(t.defaultMessage(review.remoteName, review.targetBranch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose), busyRef = useRef(busy); closeRef.current = onClose; busyRef.current = busy;
  useEffect(() => {
    const previous = window.document.activeElement;
    const app = window.document.querySelector<HTMLElement>(".app-shell"); const wasInert = app?.inert;
    if (app) app.inert = true;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); if (!busyRef.current) closeRef.current(); }
      else if ((event.ctrlKey || event.metaKey) && ["s", "n", "o", "w"].includes(event.key.toLowerCase())) { event.preventDefault(); event.stopImmediatePropagation(); }
      else if (event.key === "Tab") {
        const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary') ?? []).filter(item => item.getClientRects().length > 0);
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && window.document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && window.document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keys, true);
    return () => { window.removeEventListener("keydown", keys, true); if (app) app.inert = wasInert ?? false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let active = true; setVersions(null); setFileError(null);
    if (selected) void platform.remoteGit.readMergeFile({ planId: review.id, path: selected }).then(data => { if (active) setVersions({ path: selected, data }); }).catch(reason => { if (active) setFileError(String(reason)); });
    return () => { active = false; };
  }, [review.id, selected]);
  const selectedFile = review.files.find(file => file.path === selected);
  const complete = review.conflicts.every(group => resolutions[group.id]);
  const apply = async () => { setBusy(true); setError(null); try { await onApply(Object.values(resolutions), message); } catch (reason) { setError(String(reason)); } finally { setBusy(false); } };
  return createPortal(<div className="remote-merge-backdrop"><section ref={dialog} className="remote-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-merge-title">
    <header className="remote-merge-header"><div><h2 id="remote-merge-title">{t.title}</h2><span>{review.remoteName}/{review.targetBranch} · {review.local.shortId} → {review.remote.shortId}</span></div><button type="button" disabled={busy} onClick={onClose}>{t.close}</button><p>{t.scope}</p><small>{t.cached}</small></header>
    <div className="remote-merge-layout"><aside className="remote-merge-files">
      <details className="remote-merge-history"><summary>{t.commits}</summary>{(["local", "remote"] as const).map(side => <section key={side}><h3>{t[side]} · {t.historyCount(review[side === "local" ? "localCount" : "remoteCount"])}</h3><ol>{review[side === "local" ? "localCommits" : "remoteCommits"].map(commit => <li key={commit.id} title={`${commit.authorName ?? ""} · ${commit.timestamp}`}><code>{commit.shortId}</code> {commit.message}</li>)}</ol></section>)}{(review.localCount > 100 || review.remoteCount > 100) && <small>{t.moreHistory}</small>}</details>
      <h3>{t.files} · {review.files.length}</h3>
      {review.files.map(file => <button type="button" key={file.path} title={file.path} className={file.path === selected ? "is-selected" : ""} onClick={() => setSelected(file.path)}><span>{file.path}</span><small className={file.conflictId && !resolutions[file.conflictId] ? "is-conflict" : ""}>{file.conflictId ? resolutions[file.conflictId] ? t.resolved : t.conflict : file.localChanged && file.remoteChanged ? t.automatic : file.localChanged ? t.localOnly : t.remoteOnly}</small></button>)}
    </aside><main className="remote-merge-preview">
      {fileError ? <p role="alert">{fileError}</p> : selected && !versions ? <p>{t.loading}</p> : versions && selectedFile ? <FileReview key={selected} review={review} path={selected} versions={versions.data} document={document} text={text} resolution={selectedFile.conflictId ? resolutions[selectedFile.conflictId] : undefined} onResolution={value => setResolutions(current => { const next = { ...current }; if (selectedFile.conflictId) { if (value) next[selectedFile.conflictId] = value; else delete next[selectedFile.conflictId]; } return next; })} /> : <p>{t.noFiles}</p>}
    </main></div>
    <footer className="remote-merge-footer"><div><p>{t[review.relationship]}</p>{review.conflicts.length > 0 && <p>{t.summary(Object.keys(resolutions).length, review.conflicts.length)}</p>}{blocked && <p role="alert">{t.unsaved}</p>}{error && <p className="is-error" role="alert">{error}</p>}</div><label>{t.message}<input value={message} maxLength={2000} disabled={busy} onChange={event => setMessage(event.target.value)} /></label><button type="button" className="is-primary" disabled={busy || blocked || !complete || !message.trim() || review.remoteCount === 0} onClick={() => void apply()}>{busy ? t.applying : review.relationship === "incoming" ? t.fastForward : t.apply}</button></footer>
  </section></div>, window.document.body);
}
