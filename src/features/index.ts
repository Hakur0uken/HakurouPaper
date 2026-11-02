import { createFeatureRegistry } from "./registry";
import { pandocSidebarContribution } from "./pandoc";
import { versionControlSidebarContribution } from "./version-control";
import { remoteSyncSidebarContribution } from "./remote-sync";

export { RenderedRevisionViewer, VersionDiffViewer, releaseHistoricalAssetsForDocument, releaseRevisionDataForDocument } from "./version-control";

export const featureRegistry = createFeatureRegistry([
  pandocSidebarContribution,
  versionControlSidebarContribution,
  remoteSyncSidebarContribution,
]);

export type { FeatureDocumentContext, FeatureWorkspaceProps, SidebarContribution } from "./registry";
