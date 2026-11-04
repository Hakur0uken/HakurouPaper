export type GitAccount = { id: string; host: string; login: string };
export type GitAccountStatus = { accounts: GitAccount[]; credentialStorageAvailable: boolean };
export type GitRemote = {
  name: string; fetchUrl: string; pushUrl: string; host: string; provider: string;
  targetBranch: string; ahead: number | null; behind: number | null;
  accountId: string | null; accountIssue: string | null;
};
export type RemoteRepository = {
  repositoryRoot: string; branch: string | null; hasCommits: boolean; dirty: boolean;
  remotes: GitRemote[]; stateToken: string; changedPaths: string[];
  defaultRemote: string | null;
};
export type RemoteAction = "fetch" | "pull" | "push";
export interface RemoteGitService {
  inspect(documentPath: string): Promise<RemoteRepository>;
  add(input: { documentPath: string; name: string; url: string }): Promise<RemoteRepository>;
  bindAccount(input: { documentPath: string; remote: string; accountId: string }): Promise<RemoteRepository>;
  sync(input: { documentPath: string; remote: string; action: RemoteAction; stateToken: string }): Promise<RemoteRepository>;
  accounts(): Promise<GitAccountStatus>;
  saveAccount(input: { host: string; login: string; secret: string }): Promise<GitAccount>;
  removeAccount(accountId: string): Promise<void>;
}
