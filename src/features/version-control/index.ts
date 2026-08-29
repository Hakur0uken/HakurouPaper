import type { SidebarContribution } from "../registry";
import { VersionControlIcon } from "./VersionControlIcon";
import { VersionControlWorkspace } from "./VersionControlWorkspace";

export { VersionDiffViewer } from "./VersionDiffViewer";
export { RenderedRevisionViewer } from "./RenderedRevisionViewer";
export { RevisionOverviewRuler } from "./RevisionOverviewRuler";
export { useCurrentRevisionLocations } from "./revisionLocationState";
export { releaseRevisionDataForDocument } from "./revisionDataCache";
export { releaseHistoricalAssetsForDocument } from "./RenderedRevisionViewer";
export type { RevisionLocation } from "./revisionTypes";

export const versionControlSidebarContribution: SidebarContribution = {
  id: "version-control",
  Icon: VersionControlIcon,
  label: (text) => text.versionManagement,
  Workspace: VersionControlWorkspace,
};
