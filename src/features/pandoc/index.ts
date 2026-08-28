import type { SidebarContribution } from "../registry";
import { PandocDeliveryIcon } from "./PandocDeliveryIcon";
import { PandocWorkspace } from "./PandocWorkspace";

export const pandocSidebarContribution: SidebarContribution = {
  id: "pandoc-delivery",
  Icon: PandocDeliveryIcon,
  label: (text) => text.documentDelivery,
  Workspace: PandocWorkspace,
};
