import type { ComponentType } from "react";
import type { AssetV1 } from "../core/schema";
import type { UiText } from "../i18n";
import type { VersionChange, VersionRecord } from "../platform";

export type FeatureDocumentContext = {
  title: string;
  path: string | null;
  content: string;
  assetFolder: string | null;
  assets: AssetV1[];
  /** Current in-memory hakurou.json content; used only by read-only revision rendering. */
  sidecarContent: string;
  isDirty: boolean;
  versionStatusRevision: number;
};

export type FeatureWorkspaceProps = {
  document: FeatureDocumentContext;
  text: UiText;
  onSaveDocument: () => Promise<boolean>;
  showRevisionChanges: boolean;
  onShowRevisionChangesChange: (enabled: boolean) => void;
  onVersionStateChanged: () => void;
  onOpenVersionDiff: (change: VersionChange) => void;
  onOpenVersionHistoryComparison: (version: VersionRecord) => void;
};

export type SidebarContribution = {
  id: string;
  Icon: ComponentType;
  label: (text: UiText) => string;
  Workspace: ComponentType<FeatureWorkspaceProps>;
};

export type FeatureRegistry = {
  sidebarContributions: readonly SidebarContribution[];
  getSidebarContribution: (id: string | null) => SidebarContribution | null;
};

export function createFeatureRegistry(sidebarContributions: readonly SidebarContribution[]): FeatureRegistry {
  const ids = new Set<string>();
  for (const contribution of sidebarContributions) {
    if (ids.has(contribution.id)) throw new Error(`重复的功能标识：${contribution.id}`);
    ids.add(contribution.id);
  }
  return {
    sidebarContributions,
    getSidebarContribution: (id) => sidebarContributions.find((contribution) => contribution.id === id) ?? null,
  };
}
