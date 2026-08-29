import { useEffect, useMemo, useRef, useState } from "react";
import type { RevisionTextSnapshot, VersionComparison } from "../../platform";
import type { FeatureDocumentContext } from "../registry";
import type { LightweightRevisionDiffInput } from "./lightweightRevisionDiff";
import { getRevisionComparisonData } from "./revisionDataCache";
import type { RevisionLocation } from "./revisionTypes";

type Baseline = {
  key: string;
  documentPath: string;
  comparison: VersionComparison;
  snapshot: RevisionTextSnapshot;
  assetPaths: string[];
};

export type RevisionLocationState = {
  kind: "idle" | "loading" | "ready" | "error";
  /** Stale locations deliberately remain present until a replacement has finished. */
  locations: RevisionLocation[];
  comparison?: VersionComparison;
  message?: string;
};

type WorkerResult =
  | { type: "result"; requestId: number; locations: RevisionLocation[] }
  | { type: "error"; requestId: number; message: string };

const emptyState: RevisionLocationState = { kind: "idle", locations: [] };

function baselineKey(document: FeatureDocumentContext) {
  return document.path ? `${document.path}\u0000${document.assetFolder ?? ""}\u0000${document.headRevisionEpoch}` : "";
}

function currentAssetPaths(document: FeatureDocumentContext) {
  return document.assets.flatMap((asset) => [asset.source.path, asset.preview?.path].filter((path): path is string => Boolean(path)));
}

function snapshotAssetPaths(snapshot: RevisionTextSnapshot) {
  return snapshot.assets.map((asset) => asset.path);
}

/**
 * Keeps the Git revision baseline cached, then sends only editor-side document
 * data to a worker after a short settled-input delay. No Git call is part of
 * the typing path.
 */
export function useCurrentRevisionLocations(document: FeatureDocumentContext, enabled: boolean): RevisionLocationState {
  const [state, setState] = useState<RevisionLocationState>(emptyState);
  const [baselineEpoch, setBaselineEpoch] = useState(0);
  const baselineRef = useRef<Baseline | null>(null);
  const baselineRequestRef = useRef(0);
  const diffRequestRef = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const key = baselineKey(document);
  const afterAssetPaths = useMemo(() => currentAssetPaths(document), [document.assets]);

  useEffect(() => {
    const worker = new Worker(new URL("./revisionDiff.worker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;
    const onMessage = (event: MessageEvent<WorkerResult>) => {
      const result = event.data;
      if (result.requestId !== diffRequestRef.current) return;
      if (result.type === "error") {
        setState((current) => ({ ...current, kind: "error", message: result.message }));
        return;
      }
      const baseline = baselineRef.current;
      setState({ kind: "ready", locations: result.locations, ...(baseline ? { comparison: baseline.comparison } : {}) });
    };
    worker.addEventListener("message", onMessage);
    return () => {
      worker.removeEventListener("message", onMessage);
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    // Invalidate both a queued debounce and an already-running worker result.
    diffRequestRef.current += 1;
    if (!enabled || !document.path) {
      if (!document.path) baselineRef.current = null;
      setState(emptyState);
      return;
    }
    const cached = baselineRef.current;
    if (cached?.key === key) {
      // Re-enabling the switch can reuse the immutable historical baseline.
      setBaselineEpoch((current) => current + 1);
      return;
    }
    const requestId = ++baselineRequestRef.current;
    const preserveLocations = cached?.documentPath === document.path;
    if (!preserveLocations) setState({ kind: "loading", locations: [] });
    void (async () => {
      try {
        const { comparison, before: snapshot } = await getRevisionComparisonData(document);
        if (requestId !== baselineRequestRef.current) return;
        baselineRef.current = {
          key,
          documentPath: document.path!,
          comparison,
          snapshot,
          assetPaths: snapshotAssetPaths(snapshot),
        };
        setBaselineEpoch((current) => current + 1);
      } catch (error) {
        if (requestId !== baselineRequestRef.current) return;
        setState((current) => ({ ...current, kind: "error", message: String(error) }));
      }
    })();
  }, [document.assetFolder, document.path, enabled, key]);

  useEffect(() => {
    // Each keystroke only invalidates old worker work and resets this timer.
    const requestId = ++diffRequestRef.current;
    const baseline = baselineRef.current;
    if (!enabled || !document.path || !baseline || baseline.key !== key) return;
    const input: LightweightRevisionDiffInput = {
      beforeMarkdown: baseline.snapshot.markdown,
      afterMarkdown: document.content,
      beforeMetadata: baseline.snapshot.metadata,
      afterMetadata: document.sidecarContent,
      beforeAssetPaths: baseline.assetPaths,
      afterAssetPaths,
    };
    const timer = window.setTimeout(() => {
      workerRef.current?.postMessage({ type: "compute", requestId, input });
    }, 280);
    return () => window.clearTimeout(timer);
  }, [afterAssetPaths, baselineEpoch, document.content, document.path, document.sidecarContent, enabled, key]);

  return state;
}
