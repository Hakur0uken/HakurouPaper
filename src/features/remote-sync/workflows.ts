import type { GitRemote, RemoteGitService, RemoteRepository } from "../../platform/remoteTypes";
import type { RemoteSyncText } from "./text";
import type { RemoteMergeResolution, RemoteMergeReview } from "../../platform/remoteMergeTypes";

export type UploadTarget = { repository: RemoteRepository; remote: GitRemote; createVersion: boolean };

function sameTarget(expected: UploadTarget, current: RemoteRepository) {
  const remote = current.remotes.find((item) => item.name === expected.remote.name);
  return current.repositoryRoot === expected.repository.repositoryRoot
    && current.branch === expected.repository.branch
    && remote?.fetchUrl === expected.remote.fetchUrl
    && remote?.pushUrl === expected.remote.pushUrl
    && remote?.targetBranch === expected.remote.targetBranch
    && remote?.accountId === expected.remote.accountId
    && !remote?.accountIssue;
}

/** Keep the reviewed destination fixed, but use the new HEAD token after committing. */
export async function uploadVersion(
  service: RemoteGitService, path: string, target: UploadTarget,
  createVersion: () => Promise<boolean>, text: RemoteSyncText,
): Promise<RemoteRepository | null> {
  let created = false;
  try {
    let current = await service.inspect(path);
    if (!sameTarget(target, current) || current.stateToken !== target.repository.stateToken) throw new Error(text.targetChanged);
    if (target.createVersion) {
      if (!await createVersion()) return null;
      created = true;
      current = await service.inspect(path);
      if (!sameTarget(target, current)) throw new Error(text.targetChanged);
    }
    return await service.sync({ documentPath: path, remote: target.remote.name, action: "push", stateToken: current.stateToken });
  } catch (error) {
    throw new Error(created ? `${text.createdUploadFailed}\n${String(error)}` : String(error));
  }
}

/** Pull the configured upstream, or the sole remote of a newly connected clone. */
export async function updateWorkingDirectory(
  service: RemoteGitService, path: string, hasUnsavedDocuments: () => boolean, text: RemoteSyncText,
): Promise<RemoteRepository> {
  if (hasUnsavedDocuments()) throw new Error(text.unsaved);
  const repository = await service.inspect(path);
  const remote = repository.remotes.find((item) => item.name === repository.defaultRemote);
  if (!repository.remotes.length) throw new Error(text.connectFirst);
  if (!remote) throw new Error(text.choosePullRemote);
  if (!repository.branch) throw new Error(text.detached);
  if (!repository.hasCommits) throw new Error(text.noCommits);
  if (remote.accountIssue) throw new Error(remote.accountIssue);
  if (repository.dirty) throw new Error(text.dirty);
  if (hasUnsavedDocuments()) throw new Error(text.unsaved);
  return service.sync({ documentPath: path, remote: remote.name, action: "pull", stateToken: repository.stateToken });
}

/** Recheck the reviewed repository and the live unsaved state before publishing. */
export async function completeReviewedMerge(service: RemoteGitService, path: string, review: RemoteMergeReview, resolutions: RemoteMergeResolution[], message: string, hasUnsavedDocuments: () => boolean, text: RemoteSyncText) {
  if (hasUnsavedDocuments()) throw new Error(text.unsaved);
  const current = await service.inspect(path);
  if (current.stateToken !== review.stateToken || current.repositoryRoot !== review.repositoryRoot || current.branch !== review.branch) throw new Error(text.targetChanged);
  if (current.dirty) throw new Error(text.dirty);
  if (hasUnsavedDocuments()) throw new Error(text.unsaved);
  return service.completeMerge({ planId: review.id, resolutions, message });
}
