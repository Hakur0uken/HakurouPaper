import { invoke } from "@tauri-apps/api/core";
import type { RemoteGitService } from "../remoteTypes";

export const tauriRemoteGit: RemoteGitService = {
  inspect: (documentPath) => invoke("inspect_remote_repository", { documentPath }),
  add: (input) => invoke("add_git_remote", input),
  bindAccount: (input) => invoke("bind_git_remote_account", input),
  sync: (input) => invoke("sync_git_remote", input),
  prepareMerge: (input) => invoke("prepare_remote_merge", input),
  readMergeFile: (input) => invoke("read_remote_merge_file", input),
  readMergeAsset: (input) => invoke("read_remote_merge_asset", input),
  completeMerge: (input) => invoke("complete_remote_merge", input),
  discardMerge: (planId) => invoke("discard_remote_merge", { planId }),
  accounts: () => invoke("inspect_git_accounts"),
  saveAccount: (input) => invoke("save_git_account", input),
  removeAccount: (accountId) => invoke("remove_git_account", { accountId }),
};
