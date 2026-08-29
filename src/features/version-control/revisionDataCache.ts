import { platform, type RevisionTextSnapshot, type VersionComparison } from "../../platform";
import type { FeatureDocumentContext } from "../registry";

export type RevisionComparisonData = {
  comparison: VersionComparison;
  before: RevisionTextSnapshot;
};

type CachedEntry<T> = {
  documentPath: string;
  promise: Promise<T>;
  lastUsed: number;
};

const comparisonCache = new Map<string, CachedEntry<RevisionComparisonData>>();
const textSnapshotCache = new Map<string, CachedEntry<RevisionTextSnapshot>>();
const maximumComparisonEntries = 12;
const maximumSnapshotEntries = 16;

function cacheScope(document: Pick<FeatureDocumentContext, "path" | "assetFolder" | "headRevisionEpoch">) {
  return `${document.path ?? ""}\u0000${document.assetFolder ?? ""}\u0000${document.headRevisionEpoch}`;
}

function comparisonKey(document: FeatureDocumentContext, versionId?: string | null) {
  return `${cacheScope(document)}\u0000${versionId ?? "current"}`;
}

function evictLeastRecentlyUsed<T>(cache: Map<string, CachedEntry<T>>, maximumEntries: number) {
  while (cache.size > maximumEntries) {
    let oldestKey: string | undefined;
    let oldestUsed = Number.POSITIVE_INFINITY;
    cache.forEach((entry, key) => {
      if (entry.lastUsed < oldestUsed) {
        oldestKey = key;
        oldestUsed = entry.lastUsed;
      }
    });
    if (!oldestKey) return;
    cache.delete(oldestKey);
  }
}

function invalidateStaleBaselines(document: FeatureDocumentContext) {
  if (!document.path) return;
  comparisonCache.forEach((_entry, key) => {
    const [path, assetFolder, epoch] = key.split("\u0000");
    if (path === document.path && (assetFolder !== (document.assetFolder ?? "") || epoch !== String(document.headRevisionEpoch))) {
      comparisonCache.delete(key);
    }
  });
}

/** Release per-document historical data after a tab is closed. */
export function releaseRevisionDataForDocument(documentPath: string | null) {
  if (!documentPath) return;
  comparisonCache.forEach((entry, key) => {
    if (entry.documentPath === documentPath) comparisonCache.delete(key);
  });
  textSnapshotCache.forEach((entry, key) => {
    if (entry.documentPath === documentPath) textSnapshotCache.delete(key);
  });
}

/**
 * The immutable base revision is shared by editor markers and rendered previews.
 * A HEAD epoch bump creates a new key after creating or restoring a revision.
 */
export function getRevisionComparisonData(document: FeatureDocumentContext, versionId?: string | null) {
  if (!document.path) return Promise.reject(new Error("当前文稿尚未保存。"));
  invalidateStaleBaselines(document);
  const key = comparisonKey(document, versionId);
  const cached = comparisonCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.promise;
  }
  const request = platform.versionControl
    .getComparison({ documentPath: document.path, assetFolder: document.assetFolder, versionId })
    .then(async (comparison) => ({
      comparison,
      before: await getCachedRevisionTextSnapshot(document, comparison.baseRevision.id ?? null),
    }));
  comparisonCache.set(key, { documentPath: document.path, promise: request, lastUsed: Date.now() });
  evictLeastRecentlyUsed(comparisonCache, maximumComparisonEntries);
  void request.catch(() => comparisonCache.delete(key));
  return request;
}

export function getCachedRevisionTextSnapshot(document: FeatureDocumentContext, revisionId: string | null) {
  if (!document.path) return Promise.reject(new Error("当前文稿尚未保存。"));
  const key = `${cacheScope(document)}\u0000${revisionId ?? "empty"}`;
  const cached = textSnapshotCache.get(key);
  if (cached) {
    cached.lastUsed = Date.now();
    return cached.promise;
  }
  const request = platform.versionControl.getRevisionTextSnapshot({
    documentPath: document.path,
    assetFolder: document.assetFolder,
    revisionId,
  });
  textSnapshotCache.set(key, { documentPath: document.path, promise: request, lastUsed: Date.now() });
  evictLeastRecentlyUsed(textSnapshotCache, maximumSnapshotEntries);
  void request.catch(() => textSnapshotCache.delete(key));
  return request;
}
