import { createFeatureRegistry } from "./registry";
import { pandocSidebarContribution } from "./pandoc";
import { versionControlSidebarContribution } from "./version-control";

export { RenderedRevisionViewer, VersionDiffViewer, releaseHistoricalAssetsForDocument, releaseRevisionDataForDocument } from "./version-control";

export const featureRegistry = createFeatureRegistry([
  pandocSidebarContribution,
  versionControlSidebarContribution,
]);

export type { FeatureDocumentContext, FeatureWorkspaceProps, SidebarContribution } from "./registry";
