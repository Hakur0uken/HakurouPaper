import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import katex from "katex";
import { parseDocumentSidecar } from "../../core/schema";
import { parseDocumentFormatSettings } from "../../formatTypes";
import { fontFamilyStack } from "../../appearanceSettings";
import type { UiText } from "../../i18n";
import { platform, type RevisionAssetManifest, type RevisionDescriptor, type RevisionTextSnapshot, type VersionChange, type VersionComparison } from "../../platform";
import type { FeatureDocumentContext } from "../registry";
import { RevisionOverviewRuler } from "./RevisionOverviewRuler";
import { getCachedRevisionTextSnapshot, getRevisionComparisonData } from "./revisionDataCache";
import type { InlineDiffPart, MarkdownNode, RenderedRevisionModel, RevisionBlock } from "./renderedRevisionModel";
import type { RevisionBlockAnchor, RevisionLocation } from "./revisionTypes";

type ViewerState =
  | { kind: "loading" }
  | { kind: "ready"; comparison: VersionComparison; before: RevisionTextSnapshot; after: RevisionTextSnapshot }
  | { kind: "error"; message: string };
type ModelState = { kind: "idle" | "building" } | { kind: "ready"; model: RenderedRevisionModel; locations: RevisionLocation[] } | { kind: "error"; message: string };
type WorkerResult =
  | { type: "result"; requestId: number; model: RenderedRevisionModel; locations: RevisionLocation[] }
  | { type: "error"; requestId: number; message: string };
type RevisionAssetContext = {
  snapshot: RevisionTextSnapshot;
  documentPath: string;
  assetFolder: string | null;
  workingDocumentPath?: string | null;
  previewPaths: Map<string, string>;
  manifestPaths: Set<string>;
};

const formulaHtmlCache = new Map<string, string | null>();
const maximumFormulaCacheEntries = 128;
const historicalAssetRequests = new Map<string, Promise<HistoricalAssetResult | null>>();
const historicalAssetCache = new Map<string, HistoricalAssetCacheEntry>();
const releasedHistoricalAssetDocuments = new Set<string>();
const maximumHistoricalAssetEntries = 24;
const maximumHistoricalAssetBytes = 64 * 1024 * 1024;

type HistoricalAssetCacheEntry = {
  documentPath: string;
  url: string;
  size: number;
  lastUsed: number;
  consumers: number;
};

type HistoricalAssetResult = { key: string; url: string };

function touchFormulaCache(key: string, value: string | null) {
  formulaHtmlCache.delete(key);
  formulaHtmlCache.set(key, value);
  while (formulaHtmlCache.size > maximumFormulaCacheEntries) {
    const oldestKey = formulaHtmlCache.keys().next().value as string | undefined;
    if (!oldestKey) return;
    formulaHtmlCache.delete(oldestKey);
  }
}

function historicalAssetCacheBytes() {
  let bytes = 0;
  historicalAssetCache.forEach((entry) => { bytes += entry.size; });
  return bytes;
}

function hasHistoricalAssetForDocument(documentPath: string) {
  for (const entry of historicalAssetCache.values()) {
    if (entry.documentPath === documentPath) return true;
  }
  for (const key of historicalAssetRequests.keys()) {
    if (key.startsWith(`${documentPath}\u0000`)) return true;
  }
  return false;
}

function forgetReleasedDocumentWhenDrained(documentPath: string) {
  if (!hasHistoricalAssetForDocument(documentPath)) releasedHistoricalAssetDocuments.delete(documentPath);
}

function evictHistoricalAssets(protectedKey?: string) {
  while (historicalAssetCache.size > maximumHistoricalAssetEntries || historicalAssetCacheBytes() > maximumHistoricalAssetBytes) {
    let oldestKey: string | undefined;
    let oldestUsed = Number.POSITIVE_INFINITY;
    historicalAssetCache.forEach((entry, key) => {
      if (key !== protectedKey && entry.consumers === 0 && entry.lastUsed < oldestUsed) {
        oldestKey = key;
        oldestUsed = entry.lastUsed;
      }
    });
    // Every remaining URL is rendered somewhere; defer eviction until it is
    // released so an <img> never loses its Blob URL underneath React.
    if (!oldestKey) return;
    const entry = historicalAssetCache.get(oldestKey);
    if (entry) URL.revokeObjectURL(entry.url);
    historicalAssetCache.delete(oldestKey);
  }
}

function retainHistoricalAsset(key: string) {
  const entry = historicalAssetCache.get(key);
  if (!entry) return;
  entry.consumers += 1;
  entry.lastUsed = Date.now();
}

function releaseHistoricalAsset(key: string) {
  const entry = historicalAssetCache.get(key);
  if (!entry) return;
  entry.consumers = Math.max(0, entry.consumers - 1);
  entry.lastUsed = Date.now();
  if (entry.consumers === 0 && releasedHistoricalAssetDocuments.has(entry.documentPath)) {
    URL.revokeObjectURL(entry.url);
    historicalAssetCache.delete(key);
    forgetReleasedDocumentWhenDrained(entry.documentPath);
    return;
  }
  evictHistoricalAssets();
}

/** Revoke unused historical Blob URLs when the associated tab is closed. */
export function releaseHistoricalAssetsForDocument(documentPath: string | null) {
  if (!documentPath) return;
  releasedHistoricalAssetDocuments.add(documentPath);
  historicalAssetCache.forEach((entry, key) => {
    if (entry.documentPath === documentPath && entry.consumers === 0) {
      URL.revokeObjectURL(entry.url);
      historicalAssetCache.delete(key);
    }
  });
  forgetReleasedDocumentWhenDrained(documentPath);
}

function markdownChildren(node: MarkdownNode | undefined) {
  return node?.children ?? [];
}

function normalizedAssetPath(path: string) {
  let normalized = path.replace(/\\/g, "/");
  try { normalized = decodeURIComponent(normalized); } catch { /* Preserve malformed URL sequences. */ }
  const segments: string[] = [];
  normalized.split("/").forEach((segment) => {
    if (!segment || segment === ".") return;
    if (segment === "..") { segments.pop(); return; }
    segments.push(segment);
  });
  return `./${segments.join("/")}`;
}

function imageUrlForNode(node: MarkdownNode) {
  if (node.type === "image") return node.url;
  return markdownChildren(node).find((child) => child.type === "image")?.url;
}

function directImageFormat(path: string) {
  return /\.(?:png|jpe?g|webp|gif|bmp|svg)$/i.test(path);
}

function assetMime(path: string, declared?: string) {
  if (declared) return declared;
  if (/\.jpe?g$/i.test(path)) return "image/jpeg";
  if (/\.webp$/i.test(path)) return "image/webp";
  if (/\.gif$/i.test(path)) return "image/gif";
  if (/\.bmp$/i.test(path)) return "image/bmp";
  if (/\.svg$/i.test(path)) return "image/svg+xml";
  return "image/png";
}

function currentAssetManifest(document: FeatureDocumentContext, changes: VersionChange[] = []): RevisionAssetManifest[] {
  const assets = new Map<string, RevisionAssetManifest>();
  const workingImageChanged = (path: string) => {
    const assetPath = normalizedAssetPath(path).slice(2);
    return changes.some((change) => change.resourceKind === "image" && change.kind !== "deleted" && change.path.replace(/\\/g, "/").endsWith(assetPath));
  };
  document.assets.forEach((asset) => {
    [asset.source, asset.preview].filter((resource): resource is NonNullable<typeof resource> => Boolean(resource)).forEach((resource) => {
      assets.set(resource.path, {
        path: resource.path,
        mimeType: assetMime(resource.path, resource.mimeType),
        ...(workingImageChanged(resource.path) ? { contentIdentity: `working-tree-change:${normalizedAssetPath(resource.path)}` } : {}),
      });
    });
  });
  return [...assets.values()];
}

function currentTextSnapshot(document: FeatureDocumentContext, revision: RevisionDescriptor, changes: VersionChange[]): RevisionTextSnapshot {
  return { revision, markdown: document.content, metadata: document.sidecarContent, assets: currentAssetManifest(document, changes) };
}

function createAssetContext(snapshot: RevisionTextSnapshot, documentPath: string, assetFolder: string | null, workingDocumentPath?: string | null): RevisionAssetContext {
  const previewPaths = new Map<string, string>();
  try {
    parseDocumentSidecar(snapshot.metadata).sidecar.assets.forEach((asset) => {
      if (asset.preview?.path && directImageFormat(asset.preview.path)) previewPaths.set(normalizedAssetPath(asset.source.path), asset.preview.path);
    });
  } catch { /* Invalid sidecar metadata must not prevent body rendering. */ }
  return { snapshot, documentPath, assetFolder, workingDocumentPath, previewPaths, manifestPaths: new Set(snapshot.assets.map((asset) => normalizedAssetPath(asset.path))) };
}

function preferredImagePath(context: RevisionAssetContext, path: string | undefined) {
  if (!path) return undefined;
  const normalized = normalizedAssetPath(path);
  const preview = context.previewPaths.get(normalized);
  if (preview && context.manifestPaths.has(normalizedAssetPath(preview))) return preview;
  return context.manifestPaths.has(normalized) || context.snapshot.revision.kind === "currentDocument" ? path : undefined;
}

function blobUrlFromBase64(dataBase64: string, mimeType: string) {
  const bytes = Uint8Array.from(window.atob(dataBase64), (value) => value.charCodeAt(0));
  return { url: URL.createObjectURL(new Blob([bytes], { type: mimeType })), size: bytes.byteLength };
}

function historicalImageUrl(context: RevisionAssetContext, path: string) {
  const revisionId = context.snapshot.revision.id;
  if (!revisionId) return Promise.resolve(null);
  releasedHistoricalAssetDocuments.delete(context.documentPath);
  const key = `${context.documentPath}\u0000${revisionId}\u0000${path}`;
  const cachedAsset = historicalAssetCache.get(key);
  if (cachedAsset) {
    cachedAsset.lastUsed = Date.now();
    return Promise.resolve({ key, url: cachedAsset.url });
  }
  const cached = historicalAssetRequests.get(key);
  if (cached) return cached;
  const request = platform.versionControl.getRevisionAsset({ documentPath: context.documentPath, assetFolder: context.assetFolder, revisionId, assetPath: path })
    .then((asset) => {
      if (!asset) return null;
      const blob = blobUrlFromBase64(asset.dataBase64, asset.mimeType);
      if (releasedHistoricalAssetDocuments.has(context.documentPath)) {
        URL.revokeObjectURL(blob.url);
        return null;
      }
      historicalAssetCache.set(key, {
        documentPath: context.documentPath,
        url: blob.url,
        size: blob.size,
        lastUsed: Date.now(),
        consumers: 0,
      });
      evictHistoricalAssets(key);
      return { key, url: blob.url };
    })
    .finally(() => {
      historicalAssetRequests.delete(key);
      forgetReleasedDocumentWhenDrained(context.documentPath);
    });
  historicalAssetRequests.set(key, request);
  return request;
}

function useNearViewport<T extends Element>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      observer.disconnect();
    }, { rootMargin: "640px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, visible };
}

function formulaPreviewValue(value: string) {
  return value.replace(/\\(?:notag|nonumber)\b/g, "").replace(/\\tag\*?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "").trim();
}

function formulaHtml(value: string, display: boolean) {
  const source = formulaPreviewValue(value) || "\\text{公式为空}";
  const key = `${display ? "display" : "inline"}\u0000${source}`;
  if (formulaHtmlCache.has(key)) {
    const cached = formulaHtmlCache.get(key)!;
    touchFormulaCache(key, cached);
    return cached;
  }
  try {
    const html = katex.renderToString(source, { displayMode: display, throwOnError: true, strict: "ignore" });
    touchFormulaCache(key, html);
    return html;
  } catch {
    touchFormulaCache(key, null);
    return null;
  }
}

const Formula = memo(function Formula({ value, display }: { value: string; display: boolean }) {
  const { ref, visible } = useNearViewport<HTMLSpanElement>();
  const html = visible ? formulaHtml(value, display) : undefined;
  if (!visible) return <span ref={ref} className={`revision-formula-pending${display ? " is-display" : ""}`}><code>{formulaPreviewValue(value) || "公式"}</code></span>;
  if (!html) return <details className="revision-formula-error"><summary>公式预览失败</summary><code>{value}</code></details>;
  return <span ref={ref} className={display ? "revision-katex is-display" : "revision-katex"} dangerouslySetInnerHTML={{ __html: html }} />;
});

const RevisionImage = memo(function RevisionImage({ node, context }: { node: MarkdownNode; context: RevisionAssetContext }) {
  const { ref, visible } = useNearViewport<HTMLSpanElement>();
  const path = preferredImagePath(context, imageUrlForNode(node));
  const directSource = context.snapshot.revision.kind === "currentDocument" && context.workingDocumentPath && path ? platform.assets.displaySource(path, context.workingDocumentPath) : undefined;
  const [source, setSource] = useState<string | null>(directSource ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (directSource) { setSource(directSource); return; }
    setSource(null);
    if (!visible || !path) return;
    let cancelled = false;
    let retainedKey: string | null = null;
    void historicalImageUrl(context, path).then((asset) => {
      if (cancelled) return;
      if (asset) {
        retainHistoricalAsset(asset.key);
        retainedKey = asset.key;
        setSource(asset.url);
      }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (retainedKey) releaseHistoricalAsset(retainedKey);
    };
  }, [context, directSource, path, visible]);
  return <span ref={ref} className="revision-image-shell">
    {!visible && <span className="revision-image-placeholder">图片将在滚动到附近时加载</span>}
    {visible && !source && !failed && <span className="revision-image-placeholder">正在加载图片…</span>}
    {visible && (!path || failed) && <span className="revision-missing-image" title={node.url ?? undefined}>图片预览不可用{node.url && <code>{node.url}</code>}</span>}
    {source && !failed && <img className="revision-image" loading="lazy" src={source} alt={node.alt ?? ""} title={node.title ?? node.alt ?? ""} onError={() => setFailed(true)} />}
  </span>;
});

const InlineNodes = memo(function InlineNodes({ nodes, assetContext }: { nodes: MarkdownNode[]; assetContext: RevisionAssetContext }): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    const children = <InlineNodes nodes={markdownChildren(node)} assetContext={assetContext} />;
    if (node.type === "text") return <span key={key}>{node.value}</span>;
    if (node.type === "emphasis") return <em key={key}>{children}</em>;
    if (node.type === "strong") return <strong key={key}>{children}</strong>;
    if (node.type === "delete") return <del key={key}>{children}</del>;
    if (node.type === "inlineCode") return <code key={key}>{node.value}</code>;
    if (node.type === "inlineMath") return <Formula key={key} value={node.value ?? ""} display={false} />;
    if (node.type === "link") return <a key={key} href={node.url} title={node.title ?? undefined} target="_blank" rel="noreferrer">{children}</a>;
    if (node.type === "image") return <RevisionImage key={key} node={node} context={assetContext} />;
    if (node.type === "break") return <br key={key} />;
    return <span key={key}>{node.value ?? children}</span>;
  });
});

const MarkdownBlock = memo(function MarkdownBlock({ node, assetContext, inlineParts }: { node: MarkdownNode; assetContext: RevisionAssetContext; inlineParts?: InlineDiffPart[] }): ReactNode {
  const children = markdownChildren(node);
  const renderedInline = inlineParts ? inlineParts.map((part, index) => part.kind === "added" ? <ins key={index}>{part.value}</ins> : part.kind === "removed" ? <del key={index}>{part.value}</del> : <span key={index}>{part.value}</span>) : <InlineNodes nodes={children} assetContext={assetContext} />;
  if (node.type === "heading") { const Tag = (`h${Math.min(6, Math.max(1, node.depth ?? 1))}`) as keyof JSX.IntrinsicElements; return <Tag className="revision-heading">{renderedInline}</Tag>; }
  if (node.type === "paragraph") return <p className="revision-paragraph">{renderedInline}</p>;
  if (node.type === "blockquote") return <blockquote>{children.map((child, index) => <MarkdownBlock key={index} node={child} assetContext={assetContext} />)}</blockquote>;
  if (node.type === "list") { const Tag = node.ordered ? "ol" : "ul"; return <Tag start={node.ordered && node.start ? node.start : undefined}>{children.map((child, index) => <MarkdownBlock key={index} node={child} assetContext={assetContext} />)}</Tag>; }
  if (node.type === "listItem") return <li>{children.map((child, index) => <MarkdownBlock key={index} node={child} assetContext={assetContext} />)}</li>;
  if (node.type === "code") return <pre><code className={node.lang ? `language-${node.lang}` : undefined}>{node.value}</code></pre>;
  if (node.type === "math") return <Formula value={node.value ?? ""} display />;
  if (node.type === "thematicBreak") return <hr />;
  if (node.type === "table") { const [header, ...body] = children; return <table><thead>{header && <MarkdownBlock node={{ ...header, header: true, align: node.align }} assetContext={assetContext} />}</thead><tbody>{body.map((row, index) => <MarkdownBlock key={index} node={{ ...row, align: node.align }} assetContext={assetContext} />)}</tbody></table>; }
  if (node.type === "tableRow") return <tr>{children.map((cell, index) => <MarkdownBlock key={index} node={{ ...cell, type: node.header ? "tableHeader" : "tableCell", alignValue: node.align?.[index] }} assetContext={assetContext} />)}</tr>;
  if (node.type === "tableCell" || node.type === "tableHeader") { const Tag = node.type === "tableHeader" ? "th" : "td"; return <Tag style={node.alignValue ? { textAlign: node.alignValue as CSSProperties["textAlign"] } : undefined}>{renderedInline}</Tag>; }
  if (node.type === "html") return <p className="revision-unsupported-block">{node.value}</p>;
  return <div className="revision-unsupported-block">{node.value ?? children.map((child, index) => <MarkdownBlock key={index} node={child} assetContext={assetContext} />)}</div>;
});

function revisionTitle(revision: RevisionDescriptor, text: UiText, side: "left" | "right") {
  if (revision.kind === "currentDocument") return text.versionCurrentDocument;
  if (revision.kind === "empty") return text.versionNoSavedRevision;
  return revision.title ?? revision.shortId ?? (side === "left" ? text.versionPreviousVersion : text.versionThisVersion);
}

function CompactRevisionMeta({ revision, side, text }: { revision: RevisionDescriptor; side: "left" | "right"; text: UiText }) {
  const role = revision.kind === "currentDocument" ? text.versionCurrentDocument : revision.kind === "empty" ? text.versionNoSavedRevision : side === "left" ? text.versionPreviousVersion : text.versionThisVersion;
  const details = revision.kind === "version" ? [revision.title ?? revision.shortId, revision.timestamp && new Date(revision.timestamp).toLocaleString()].filter(Boolean) : [];
  return <span className="rendered-revision-meta"><strong>{role}</strong>{details.map((detail, index) => <span key={index}>· {detail}</span>)}</span>;
}

const RevisionBlockView = memo(function RevisionBlockView({ block, beforeAssets, afterAssets, location, isNavigationTarget, text }: { block: RevisionBlock; beforeAssets: RevisionAssetContext; afterAssets: RevisionAssetContext; location?: RevisionLocation; isNavigationTarget: boolean; text: UiText }) {
  const locationProps = location ? { id: location.targetId, "data-revision-location": location.id } : {};
  const targetClass = isNavigationTarget ? " is-navigation-target" : "";
  if (block.changeKind === "unchanged" && block.after) return <div className="rendered-revision-block"><MarkdownBlock node={block.after} assetContext={afterAssets} /></div>;
  if (block.changeKind === "added" && block.after) return <div {...locationProps} className={`rendered-revision-block is-added${targetClass}`}><span className="revision-change-label">{text.versionChangeAdded}</span><MarkdownBlock node={block.after} assetContext={afterAssets} /></div>;
  if (block.changeKind === "removed" && block.before) return <div {...locationProps} className={`rendered-revision-block is-removed${targetClass}`}><span className="revision-change-label">{text.versionChangeDeleted}</span><MarkdownBlock node={block.before} assetContext={beforeAssets} /></div>;
  if (!block.before || !block.after) return null;
  if (block.inlineDiff) return <div {...locationProps} className={`rendered-revision-block is-modified${targetClass}`}><MarkdownBlock node={block.after} assetContext={afterAssets} inlineParts={block.inlineDiff} /></div>;
  return <div {...locationProps} className={`rendered-revision-block is-modified revision-block-replacement${targetClass}`}><span className="revision-change-label">{text.versionBefore}</span><div className="revision-block-before"><MarkdownBlock node={block.before} assetContext={beforeAssets} /></div><span className="revision-change-label">{text.versionAfter}</span><div className="revision-block-after"><MarkdownBlock node={block.after} assetContext={afterAssets} /></div></div>;
});

function matchingAnchor(left: RevisionBlockAnchor | undefined, right: RevisionBlockAnchor | undefined) {
  if (!left || !right || left.blockKind !== right.blockKind) return false;
  if (left.imageUrl && right.imageUrl) return left.imageUrl === right.imageUrl;
  return Boolean(left.text && right.text && left.text === right.text);
}

function findMatchingLocation(locations: RevisionLocation[], requested: RevisionLocation) {
  return locations.find((location) => location.id === requested.id) ?? locations.find((location) => location.kind === requested.kind && (matchingAnchor(location.anchorAfter, requested.anchorAfter) || matchingAnchor(location.anchorBefore, requested.anchorBefore) || matchingAnchor(location.editorAnchor, requested.editorAnchor)));
}

export function RenderedRevisionViewer({ document, versionId, initialLocation, text, onClose, onOpenAdvanced, onRestoreVersion }: { document: FeatureDocumentContext; versionId: string | null; initialLocation?: RevisionLocation | null; text: UiText; onClose: () => void; onOpenAdvanced: () => void; onRestoreVersion: (targetCommitId: string, targetTitle: string) => void }) {
  const [viewerState, setViewerState] = useState<ViewerState>({ kind: "loading" });
  const [modelState, setModelState] = useState<ModelState>({ kind: "idle" });
  const [activeLocationId, setActiveLocationId] = useState<string | null>(initialLocation?.id ?? null);
  const [overviewReady, setOverviewReady] = useState(false);
  const viewerRef = useRef<HTMLElement>(null);
  const loadRequestRef = useRef(0);
  const workerRequestRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const workingChangesRef = useRef<{ key: string; request: Promise<VersionChange[]> } | null>(null);
  const [workerUnavailable, setWorkerUnavailable] = useState(false);

  useEffect(() => {
    const worker = new Worker(new URL("./renderedRevision.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const onMessage = (event: MessageEvent<WorkerResult>) => { const result = event.data; if (result.requestId !== workerRequestRef.current) return; if (result.type === "error") setModelState({ kind: "error", message: result.message }); else setModelState({ kind: "ready", model: result.model, locations: result.locations }); };
    const onWorkerFailure = () => {
      if (workerRef.current !== worker) return;
      worker.terminate();
      workerRef.current = null;
      setWorkerUnavailable(true);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onWorkerFailure);
    worker.addEventListener("messageerror", onWorkerFailure);
    return () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onWorkerFailure);
      worker.removeEventListener("messageerror", onWorkerFailure);
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!document.path) return;
    const requestId = ++loadRequestRef.current;
    // Invalidate an in-flight worker result before asynchronous snapshot work begins.
    workerRequestRef.current += 1;
    setViewerState({ kind: "loading" }); setModelState({ kind: "idle" }); setOverviewReady(false);
    void (async () => {
      try {
        const { comparison, before } = await getRevisionComparisonData(document, versionId);
        let currentChanges = comparison.changes;
        if (comparison.targetRevision.kind === "currentDocument") {
          const workingChangesKey = `${document.path}\u0000${document.assetFolder ?? ""}\u0000${document.workingTreeEpoch}`;
          if (workingChangesRef.current?.key === workingChangesKey) {
            currentChanges = await workingChangesRef.current.request;
          } else {
            // This refreshes working-tree status after a save without touching
            // the immutable HEAD snapshot. Re-renders caused by typing reuse
            // the epoch-keyed result and never call Git.
            const request = platform.versionControl.getChanges({ documentPath: document.path!, assetFolder: document.assetFolder });
            workingChangesRef.current = { key: workingChangesKey, request };
            currentChanges = await request;
          }
        }
        const after = comparison.targetRevision.kind === "currentDocument" ? currentTextSnapshot(document, comparison.targetRevision, currentChanges) : await getCachedRevisionTextSnapshot(document, comparison.targetRevision.id ?? null);
        if (requestId === loadRequestRef.current) setViewerState({ kind: "ready", comparison, before, after });
      } catch (error) { if (requestId === loadRequestRef.current) setViewerState({ kind: "error", message: String(error) }); }
    })();
  }, [document, versionId]);

  useEffect(() => {
    if (viewerState.kind !== "ready") return;
    const requestId = ++workerRequestRef.current;
    setModelState({ kind: "building" });
    const worker = workerRef.current;
    if (worker && !workerUnavailable) {
      worker.postMessage({ type: "compute", requestId, before: viewerState.before, after: viewerState.after });
      return;
    }

    // This only runs if a platform cannot start module Workers.  It keeps the
    // preview usable (and, importantly, never leaves it in a permanent
    // loading state) while the normal path remains entirely off the UI thread.
    void import("./renderedRevisionModel")
      .then(({ buildRenderedRevisionModel, buildRevisionLocations }) => {
        if (requestId !== workerRequestRef.current) return;
        const model = buildRenderedRevisionModel(viewerState.before, viewerState.after);
        if (requestId === workerRequestRef.current) setModelState({ kind: "ready", model, locations: buildRevisionLocations(model) });
      })
      .catch((error) => {
        if (requestId === workerRequestRef.current) setModelState({ kind: "error", message: `修改预览计算器无法启动：${String(error)}` });
      });
  }, [viewerState, workerUnavailable]);

  useEffect(() => {
    if (modelState.kind !== "ready") { setOverviewReady(false); return; }
    const show = () => setOverviewReady(true);
    const idle = window.requestIdleCallback?.(show, { timeout: 320 });
    const timer = idle === undefined ? window.setTimeout(show, 80) : undefined;
    return () => { if (idle !== undefined) window.cancelIdleCallback?.(idle); if (timer !== undefined) window.clearTimeout(timer); };
  }, [modelState]);

  const revisionFormatDefaults = useMemo(() => viewerState.kind === "ready" ? parseDocumentFormatSettings(parseDocumentSidecar(viewerState.after.metadata).sidecar.format).defaults : undefined, [viewerState]);
  const formatStyle = useMemo<CSSProperties | undefined>(() => revisionFormatDefaults?.font ? { "--hakurou-document-font-family": fontFamilyStack(revisionFormatDefaults.font), "--hakurou-document-font-weight": String(revisionFormatDefaults.font.weight) } as CSSProperties : undefined, [revisionFormatDefaults]);
  const beforeAssets = useMemo(() => viewerState.kind === "ready" && document.path ? createAssetContext(viewerState.before, document.path, document.assetFolder) : null, [document.assetFolder, document.path, viewerState]);
  const afterAssets = useMemo(() => viewerState.kind === "ready" && document.path ? createAssetContext(viewerState.after, document.path, document.assetFolder, viewerState.after.revision.kind === "currentDocument" ? document.path : null) : null, [document.assetFolder, document.path, viewerState]);
  const targetVersion = viewerState.kind === "ready" ? viewerState.comparison.targetRevision : null;
  const settingsChanged = viewerState.kind === "ready" && viewerState.before.metadata !== viewerState.after.metadata;
  const locations = modelState.kind === "ready" ? modelState.locations : [];
  const locationsByBlock = useMemo(() => new Map(locations.map((location) => [location.blockId, location])), [locations]);
  const activeLocationIndex = locations.findIndex((location) => location.id === activeLocationId);
  const activeLocation = locations.find((location) => location.id === activeLocationId);
  const navigateToLocation = useCallback((location: RevisionLocation) => { setActiveLocationId(location.id); window.requestAnimationFrame(() => window.document.getElementById(location.targetId)?.scrollIntoView({ block: "center", behavior: "auto" })); }, []);
  const navigateByOffset = useCallback((offset: number) => { if (locations.length === 0) return; const nextIndex = activeLocationIndex < 0 ? (offset > 0 ? 0 : locations.length - 1) : (activeLocationIndex + offset + locations.length) % locations.length; navigateToLocation(locations[nextIndex]!); }, [activeLocationIndex, locations, navigateToLocation]);

  useEffect(() => { if (!initialLocation) return; const location = findMatchingLocation(locations, initialLocation); if (location) navigateToLocation(location); }, [initialLocation, locations, navigateToLocation]);

  return <section ref={viewerRef} className="rendered-revision-viewer" aria-label={text.versionRenderedPreview}>
    <header className="rendered-revision-toolbar"><div className="rendered-revision-toolbar-main"><div className="rendered-revision-title-line"><h1>{text.versionRenderedPreview}</h1>{modelState.kind === "ready" && <span>{text.versionRenderedChangeCount(modelState.model.summary.changeGroups)}</span>}{locations.length > 0 && <span>{`${Math.max(1, activeLocationIndex + 1)} / ${locations.length}`}</span>}{settingsChanged && <span>{text.versionSettingsChanged}</span>}{document.isDirty && <span>{text.versionPreviewUnsavedContent}</span>}</div><div className="rendered-revision-actions">{locations.length > 0 && <><button type="button" onClick={() => navigateByOffset(-1)}>{text.versionPreviousChange}</button><button type="button" onClick={() => navigateByOffset(1)}>{text.versionNextChange}</button></>}<button type="button" onClick={onOpenAdvanced}>{text.versionAdvancedCompare}</button>{targetVersion?.kind === "version" && targetVersion.id && <button type="button" className="is-primary" onClick={() => onRestoreVersion(targetVersion.id!, revisionTitle(targetVersion, text, "right"))}>{text.versionRestoreThis}</button>}<button type="button" onClick={onClose}>{text.versionDiffClose}</button></div></div>{viewerState.kind === "ready" && <div className="rendered-revision-pair"><CompactRevisionMeta revision={viewerState.comparison.baseRevision} side="left" text={text} /><span className="rendered-revision-arrow" aria-hidden="true">→</span><CompactRevisionMeta revision={viewerState.comparison.targetRevision} side="right" text={text} /></div>}</header>
    {(viewerState.kind === "loading" || modelState.kind === "building") && <p className="rendered-revision-message">{text.versionRenderedLoading}</p>}
    {viewerState.kind === "error" && <p className="rendered-revision-message is-error">{viewerState.message}</p>}
    {modelState.kind === "error" && <div className="rendered-revision-message is-error"><p>{text.versionRenderedFailed}</p><p>{modelState.message}</p><button type="button" onClick={onOpenAdvanced}>{text.versionAdvancedCompare}</button></div>}
    {modelState.kind === "ready" && beforeAssets && afterAssets && <div className="rendered-revision-content"><article className={`rendered-revision-document ${revisionFormatDefaults?.tableStyle === "three-line" ? "is-three-line" : ""} ${revisionFormatDefaults?.firstLineIndent ? "is-first-line-indented" : ""}`} style={formatStyle}>{modelState.model.blocks.map((block) => { const location = locationsByBlock.get(block.id); return <RevisionBlockView key={block.id} block={block} beforeAssets={beforeAssets} afterAssets={afterAssets} location={location} isNavigationTarget={location?.targetId === activeLocation?.targetId} text={text} />; })}</article>{overviewReady && <RevisionOverviewRuler locations={locations} activeLocationId={activeLocationId} onNavigate={navigateToLocation} scrollContainer={viewerRef.current} />}</div>}
  </section>;
}
