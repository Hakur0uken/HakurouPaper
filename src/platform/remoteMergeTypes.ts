import type { RevisionAssetManifest, RevisionAssetSnapshot, VersionRecord } from "./types";
import type { RemoteRepository } from "./remoteTypes";

export type RemoteMergeConflict = { id: string; paths: string[]; editable: boolean; reasons: string[] };
export type RemoteMergeFile = { path: string; localChanged: boolean; remoteChanged: boolean; conflictId: string | null };
export type RemoteMergeReview = {
  id: string; repositoryRoot: string; branch: string; remoteName: string; targetBranch: string; stateToken: string;
  relationship: "equal" | "outgoing" | "incoming" | "diverged";
  base: VersionRecord; local: VersionRecord; remote: VersionRecord;
  localCommits: VersionRecord[]; remoteCommits: VersionRecord[]; localCount: number; remoteCount: number;
  files: RemoteMergeFile[]; conflicts: RemoteMergeConflict[];
};
export type RemoteMergeVersion = {
  kind: "missing" | "text" | "binary" | "link" | "submodule";
  content: string | null; hash: string | null; mode: string | null; size: number;
  preview: string | null; metadata: string | null; assets: RevisionAssetManifest[];
};
export type RemoteMergeFileVersions = { base: RemoteMergeVersion; local: RemoteMergeVersion; remote: RemoteMergeVersion };
export type RemoteMergeResolution = { conflictId: string; choice: "local" | "remote" | "text"; text?: string };
export interface RemoteMergeService {
  prepareMerge(input: { documentPath: string; remote: string; stateToken: string }): Promise<RemoteMergeReview>;
  readMergeFile(input: { planId: string; path: string }): Promise<RemoteMergeFileVersions>;
  readMergeAsset(input: { planId: string; revisionId: string; documentPath: string; assetPath: string }): Promise<RevisionAssetSnapshot | null>;
  completeMerge(input: { planId: string; resolutions: RemoteMergeResolution[]; message: string }): Promise<RemoteRepository>;
  discardMerge(planId: string): Promise<void>;
}
