import { useEffect, useState } from "react";
import { platform, type RevisionDocumentSnapshot, type VersionComparison } from "../../platform";
import type { FeatureDocumentContext } from "../registry";
import { buildRenderedRevisionModel, buildRevisionLocations, type RenderedRevisionModel } from "./RenderedRevisionViewer";
import type { RevisionLocation } from "./revisionTypes";

type RevisionLocationState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; comparison: VersionComparison; model: RenderedRevisionModel; locations: RevisionLocation[] }
  | { kind: "error"; message: string };

export function useCurrentRevisionLocations(document: FeatureDocumentContext, enabled: boolean): RevisionLocationState {
  const [state, setState] = useState<RevisionLocationState>({ kind: "idle" });

  useEffect(() => {
    if (!enabled || !document.path) {
      setState({ kind: "idle" });
      return;
    }
    let disposed = false;
    const timer = window.setTimeout(() => {
      setState({ kind: "loading" });
      void (async () => {
        try {
          const comparison = await platform.versionControl.getComparison({ documentPath: document.path!, assetFolder: document.assetFolder });
          const [before, current] = await Promise.all([
            platform.versionControl.getRevisionDocumentSnapshot({ documentPath: document.path!, assetFolder: document.assetFolder, revisionId: comparison.baseRevision.id ?? null }),
            platform.versionControl.getRevisionDocumentSnapshot({
              documentPath: document.path!,
              assetFolder: document.assetFolder,
              useWorkingCopy: true,
              workingContent: document.content,
            }),
          ]);
          if (disposed) return;
          const after: RevisionDocumentSnapshot = { ...current, metadata: document.sidecarContent };
          const model = buildRenderedRevisionModel(before, after);
          setState({ kind: "ready", comparison, model, locations: buildRevisionLocations(model) });
        } catch (error) {
          if (!disposed) setState({ kind: "error", message: String(error) });
        }
      })();
    }, 180);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [document.assetFolder, document.content, document.path, document.sidecarContent, document.versionStatusRevision, enabled]);

  return state;
}
