import type { SidebarContribution } from "../registry";
import { VersionControlIcon } from "./VersionControlIcon";
import { VersionControlWorkspace } from "./VersionControlWorkspace";

export { VersionDiffViewer } from "./VersionDiffViewer";

export const versionControlSidebarContribution: SidebarContribution = {
  id: "version-control",
  Icon: VersionControlIcon,
  label: (text) => text.versionManagement,
  Workspace: VersionControlWorkspace,
};
