import type { SidebarContribution } from "../registry";
import { RemoteSyncWorkspace } from "./RemoteSyncWorkspace";

function RemoteSyncIcon() {
  return <svg className="rail-icon remote-sync-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="M7 14.5h-.75a3.25 3.25 0 0 1-.5-6.46A5 5 0 0 1 15.4 6.8 3.9 3.9 0 1 1 18 14.5h-.75" />
    <path d="M9 20.25v-7.5m-2.5 2.5L9 12.75l2.5 2.5m3.5-2.5v7.5m-2.5-2.5 2.5 2.5 2.5-2.5" />
  </svg>;
}
export const remoteSyncSidebarContribution: SidebarContribution = {
  id: "remote-sync", Icon: RemoteSyncIcon, label: (text) => text.remoteSync.title, Workspace: RemoteSyncWorkspace,
};
