import { invoke } from "@tauri-apps/api/core";
import type { RemoteGitService } from "../remoteTypes";

export const tauriRemoteGit: RemoteGitService = {
  inspect: (documentPath) => invoke("inspect_remote_repository", { documentPath }),
  add: (input) => invoke("add_git_remote", input),
  bindAccount: (input) => invoke("bind_git_remote_account", input),
  sync: (input) => invoke("sync_git_remote", input),
  accounts: () => invoke("inspect_git_accounts"),
  saveAccount: (input) => invoke("save_git_account", input),
  removeAccount: (accountId) => invoke("remove_git_account", { accountId }),
};
