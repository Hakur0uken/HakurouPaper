import { platform, type RevisionTextSnapshot, type VersionComparison } from "../../platform";
import type { FeatureDocumentContext } from "../registry";

export type RevisionComparisonData = {
  comparison: VersionComparison;
  before: RevisionTextSnapshot;
};

const comparisonCache = new Map<string, Promise<RevisionComparisonData>>();
const textSnapshotCache = new Map<string, Promise<RevisionTextSnapshot>>();

function cacheScope(document: Pick<FeatureDocumentContext, "path" | "assetFolder" | "versionStatusRevision">) {
  return `${document.path ?? ""}\u0000${document.assetFolder ?? ""}\u0000${document.versionStatusRevision}`;
}

function comparisonKey(document: FeatureDocumentContext, versionId?: string | null) {
  return `${cacheScope(document)}\u0000${versionId ?? "current"}`;
}

/**
 * The immutable base revision is shared by editor markers and rendered previews.
 * A version-status bump creates a new key after creating/restoring a revision.
 */
export function getRevisionComparisonData(document: FeatureDocumentContext, versionId?: string | null) {
  if (!document.path) return Promise.reject(new Error("当前文稿尚未保存。"));
  const key = comparisonKey(document, versionId);
  const cached = comparisonCache.get(key);
  if (cached) return cached;
  const request = platform.versionControl
    .getComparison({ documentPath: document.path, assetFolder: document.assetFolder, versionId })
    .then(async (comparison) => ({
      comparison,
      before: await getCachedRevisionTextSnapshot(document, comparison.baseRevision.id ?? null),
    }));
  comparisonCache.set(key, request);
  void request.catch(() => comparisonCache.delete(key));
  return request;
}

export function getCachedRevisionTextSnapshot(document: FeatureDocumentContext, revisionId: string | null) {
  if (!document.path) return Promise.reject(new Error("当前文稿尚未保存。"));
  const key = `${cacheScope(document)}\u0000${revisionId ?? "empty"}`;
  const cached = textSnapshotCache.get(key);
  if (cached) return cached;
  const request = platform.versionControl.getRevisionTextSnapshot({
    documentPath: document.path,
    assetFolder: document.assetFolder,
    revisionId,
  });
  textSnapshotCache.set(key, request);
  void request.catch(() => textSnapshotCache.delete(key));
  return request;
}
