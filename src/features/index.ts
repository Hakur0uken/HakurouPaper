import { createFeatureRegistry } from "./registry";
import { pandocSidebarContribution } from "./pandoc";

export const featureRegistry = createFeatureRegistry([
  pandocSidebarContribution,
]);

export type { FeatureDocumentContext, FeatureWorkspaceProps, SidebarContribution } from "./registry";
