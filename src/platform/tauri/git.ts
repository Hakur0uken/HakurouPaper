import { invoke } from "@tauri-apps/api/core";
import type { CreateVersionInput, FileDiff, GitInstallationStatus, RestoreVersionInput, RestoreVersionPreflight, RestoreVersionResult, RevisionDocumentSnapshot, VersionAuthorIdentity, VersionChange, VersionComparison, VersionControlService, VersionRecord, VersionRepositoryInfo } from "../types";

/** The only frontend boundary that knows the Tauri command names for Git. */
export const tauriVersionControl: VersionControlService = {
  inspectGit() {
    return invoke<GitInstallationStatus>("inspect_git");
  },
  inspectRepository({ documentPath, assetFolder }) {
    return invoke<VersionRepositoryInfo>("inspect_version_repository", { documentPath, assetFolder });
  },
  initRepository({ documentPath, assetFolder }) {
    return invoke<VersionRepositoryInfo>("init_version_repository", { documentPath, assetFolder });
  },
  getChanges({ documentPath, assetFolder }) {
    return invoke<VersionChange[]>("get_version_changes", { documentPath, assetFolder });
  },
  getComparison({ documentPath, assetFolder, versionId }) {
    return invoke<VersionComparison>("get_version_comparison", { documentPath, assetFolder, versionId });
  },
  getDiff({ documentPath, assetFolder, path, versionId }) {
    return invoke<FileDiff>("get_version_diff", { documentPath, assetFolder, path, versionId });
  },
  getRevisionDocumentSnapshot({ documentPath, assetFolder, revisionId, useWorkingCopy, workingContent }) {
    return invoke<RevisionDocumentSnapshot>("get_revision_document_snapshot", { documentPath, assetFolder, revisionId, useWorkingCopy, workingContent });
  },
  createVersion({ documentPath, assetFolder, message }: CreateVersionInput) {
    return invoke<VersionRecord>("create_version", { documentPath, assetFolder, message });
  },
  getHistory({ documentPath, assetFolder, limit }) {
    return invoke<VersionRecord[]>("get_version_history", { documentPath, assetFolder, limit });
  },
  inspectIdentity({ documentPath, assetFolder }) {
    return invoke<VersionAuthorIdentity>("inspect_version_identity", { documentPath, assetFolder });
  },
  configureIdentity({ documentPath, assetFolder, name, email }) {
    return invoke<VersionAuthorIdentity>("configure_version_identity", { documentPath, assetFolder, name, email });
  },
  getRestorePreflight({ documentPath, assetFolder, targetCommitId }) {
    return invoke<RestoreVersionPreflight>("get_restore_preflight", { documentPath, assetFolder, targetCommitId });
  },
  restoreVersion({ documentPath, assetFolder, targetCommitId, strategy, safetyVersionMessage }: RestoreVersionInput) {
    return invoke<RestoreVersionResult>("restore_version", { documentPath, assetFolder, targetCommitId, strategy, safetyVersionMessage });
  },
};
