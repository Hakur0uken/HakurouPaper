import { useCallback, useEffect, useRef, useState } from "react";
import { platform, type GitAccountStatus, type RemoteAction, type RemoteRepository } from "../../platform";
import type { FeatureWorkspaceProps } from "../registry";
import { uploadVersion, type UploadTarget } from "./workflows";
import "./remoteSync.css";

type RemoteSyncProps = FeatureWorkspaceProps & {
  changesReady: boolean;
  hasDocumentChanges: boolean;
  canCreateVersion: boolean;
  onCreateVersion: () => Promise<boolean>;
  versionDescription: string;
};

export function RemoteSyncWorkspace({ document, text, repositoryBusy, runRepositoryOperation, hasUnsavedDocuments, onDiskDocumentsChanged, onVersionStateChanged, changesReady, hasDocumentChanges, canCreateVersion, onCreateVersion, versionDescription }: RemoteSyncProps) {
  const t = text.remoteSync;
  const [repository, setRepository] = useState<RemoteRepository | null>(null);
  const [accounts, setAccounts] = useState<GitAccountStatus>({ accounts: [], credentialStorageAvailable: false });
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("origin");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<"checked" | "pulled" | "pushed" | "accountSaved" | null>(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const [accountHost, setAccountHost] = useState("gitee.com");
  const [accountLogin, setAccountLogin] = useState("");
  const [secret, setSecret] = useState("");
  const [confirmPush, setConfirmPush] = useState<UploadTarget | null>(null);
  const [adding, setAdding] = useState(false);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const activePath = useRef(document.path);
  activePath.current = document.path;
  const remote = repository?.remotes.find((item) => item.name === selected) ?? repository?.remotes[0];

  const refreshAccounts = useCallback(async () => {
    const value = await platform.remoteGit.accounts();
    if (mounted.current) setAccounts(value);
  }, []);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const path = activePath.current;
    if (!path) { setRepository(null); return; }
    try {
      const result = await platform.remoteGit.inspect(path);
      if (mounted.current && request === sequence.current && path === activePath.current) {
        setRepository(result);
        setSelected((current) => result.remotes.some((r) => r.name === current) ? current : result.defaultRemote ?? result.remotes[0]?.name ?? "");
      }
    } catch (failure) {
      if (mounted.current && request === sequence.current && path === activePath.current) { setRepository(null); setError(String(failure)); }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refreshAccounts().catch((failure) => { if (mounted.current) setError(String(failure)); });
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, [refreshAccounts]);

  useEffect(() => { setRepository(null); setConfirmPush(null); setError(null); setMessage(null); setAdding(false); setName("origin"); setUrl(""); void refresh(); }, [document.path, refresh]);
  useEffect(() => { setConfirmPush(null); }, [versionDescription]);
  useEffect(() => { void refresh(); }, [document.headRevisionEpoch, document.workingTreeEpoch, refresh]);

  const perform = useCallback(async (operation: string, work: () => Promise<void>) => {
    if (busy || repositoryBusy) return;
    setBusy(operation); setError(null); setMessage(null); setConfirmPush(null);
    try { await runRepositoryOperation(work); }
    catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { if (mounted.current) setBusy(null); }
  }, [busy, repositoryBusy, runRepositoryOperation]);

  const synchronize = (action: RemoteAction) => {
    if (!document.path || !repository || !remote || (action === "pull" && hasUnsavedDocuments)) return;
    const path = document.path;
    void perform(action, async () => {
      try {
        const result = await platform.remoteGit.sync({ documentPath: path, remote: remote.name, action, stateToken: repository.stateToken });
        if (action === "pull" && result.changedPaths.length > 0) await onDiskDocumentsChanged(result.changedPaths);
        if (mounted.current && activePath.current === path) {
          setRepository(result);
          setMessage(action === "fetch" ? "checked" : action === "pull" ? "pulled" : "pushed");
        }
      } finally {
        onVersionStateChanged();
        await refresh();
      }
    });
  };

  const upload = () => {
    if (!document.path || !confirmPush) return;
    const path = document.path;
    const target = confirmPush;
    void perform("push", async () => {
      try {
        const result = await uploadVersion(platform.remoteGit, path, target, onCreateVersion, t);
        if (result && mounted.current && activePath.current === path) { setRepository(result); setMessage("pushed"); }
      } finally {
        onVersionStateChanged();
        await refresh();
      }
    });
  };

  const usesHttps = remote?.pushUrl.startsWith("https://") ?? false;
  const remoteAccounts = accounts.accounts.filter((account) => usesHttps && account.host === remote?.host);
  const working = Boolean(busy || repositoryBusy);
  const disabled = Boolean(working || !remote || !repository?.branch || !repository.hasCommits || remote.accountIssue);
  const uploadDisabled = Boolean(working || !changesReady || !remote || !repository?.branch || remote.accountIssue || (hasDocumentChanges ? !canCreateVersion : !repository.hasCommits));
  const diverged = Boolean(remote?.ahead && remote.behind);

  return <section className="version-control-card remote-sync-workspace">
    <header className="remote-section-heading"><h2>{t.title}</h2><small>{t.experimental}</small></header>
    {!repository?.remotes.length && <p className="remote-intro">{t.gettingStarted}</p>}
    {error && <p className="remote-feedback is-error" role="alert">{error}</p>}
    {message && <p className="remote-feedback" role="status">{t[message]}</p>}
    {!repository && <section className="remote-section"><p>{t.openFirst}</p><button type="button" disabled={working} onClick={() => void perform("refresh", async () => { await refresh(); await refreshAccounts(); })}>{t.refresh}</button></section>}
    {repository && <>
      <section className="remote-section">
        <div className="remote-heading"><strong>{remote ? `${remote.name} · ${remote.host}` : t.repository}</strong><button type="button" disabled={working} onClick={() => void perform("refresh", refresh)}>{t.refresh}</button></div>
        {remote && <>
          <p className="remote-path" title={remote.pushUrl}>{remote.pushUrl}</p>
          <p>{repository.branch ?? t.detached} → {remote.targetBranch}</p>
          {remote.accountIssue && <p className="remote-feedback is-error">{remote.accountIssue}</p>}
          <p>{remote.ahead !== null && remote.behind !== null ? t.counts(remote.ahead, remote.behind) : t.unknown}</p>
          {!repository.hasCommits && <p>{t.noCommits}</p>}
          {diverged && <p className="remote-notice">{t.divergent}</p>}
          <div className="remote-actions">
            <button type="button" className="is-primary" disabled={uploadDisabled || diverged} onClick={() => setConfirmPush({ repository, remote, createVersion: hasDocumentChanges })}>{busy === "push" ? t.pushing : hasDocumentChanges ? t.createAndPush : t.push}</button>
            <button type="button" disabled={disabled} onClick={() => synchronize("fetch")}>{busy === "fetch" ? t.fetching : t.fetch}</button>
            <button type="button" title={hasUnsavedDocuments ? t.unsaved : repository.dirty ? t.dirty : t.pull} disabled={disabled || hasUnsavedDocuments || repository.dirty || diverged} onClick={() => synchronize("pull")}>{busy === "pull" ? t.pulling : t.pull}</button>
          </div>
          {hasDocumentChanges && <p>{t.createAndPushHelp}</p>}
          {confirmPush && <div className="remote-confirm" role="group" aria-label={t.confirmPush}><p>{confirmPush.remote.pushUrl}<br />{confirmPush.repository.branch} → {confirmPush.remote.targetBranch}</p>{confirmPush.createVersion && <p>{versionDescription}</p>}<p className="remote-scope">{t.scope}</p><button type="button" disabled={working} onClick={upload}>{confirmPush.createVersion ? t.confirmCreateAndPush : t.confirmPush}</button><button type="button" onClick={() => setConfirmPush(null)}>{t.cancel}</button></div>}
          <details className="remote-repository-settings">
            <summary>{t.settings}</summary>
            <p className="remote-path">{repository.repositoryRoot}</p>
            <label>{t.remote}<select disabled={working} value={remote.name} onChange={(event) => { setSelected(event.target.value); setConfirmPush(null); setMessage(null); }}>{repository.remotes.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.host}</option>)}</select></label>
            <label>{t.account}<select disabled={working} value={remote.accountIssue ? "" : remote.accountId ?? "system"} onChange={(event) => void perform("account", async () => {
              const path = document.path!;
              const result = await platform.remoteGit.bindAccount({ documentPath: path, remote: remote.name, accountId: event.target.value });
              if (mounted.current && activePath.current === path) setRepository(result);
            })}>
              {remote.accountIssue && <option value="" disabled>{t.chooseAccount}</option>}
              <option value="system">{t.system}</option>
              {remoteAccounts.map((account) => <option key={account.id} value={account.id}>{account.login} · {account.host}</option>)}
            </select></label>
            {!usesHttps && <p>{t.sshHelp}</p>}
            {!adding && <button className="remote-add-toggle" type="button" disabled={working} onClick={() => { setAdding(true); setName("gitee"); }}>{t.addRemote}</button>}
          </details>
        </>}
        {(adding || repository.remotes.length === 0) && <form className="remote-add-form" onSubmit={(event) => {
          event.preventDefault();
          void perform("add", async () => {
            const path = document.path!;
            const result = await platform.remoteGit.add({ documentPath: path, name: name.trim(), url: url.trim() });
            if (mounted.current && activePath.current === path) { setRepository(result); setSelected(name.trim()); setUrl(""); setAdding(false); }
          });
        }}><label>{t.remoteName}<input required value={name} disabled={working} onChange={(event) => setName(event.target.value)} /></label><label>{t.remoteUrl}<input required value={url} disabled={working} placeholder="https://gitee.com/owner/paper.git" onChange={(event) => setUrl(event.target.value)} /></label><p>{t.addHelp}</p><button disabled={working || !url.trim() || !name.trim()} type="submit">{busy === "add" ? t.busy : t.connect}</button></form>}
      </section>
    </>}
    <details className="remote-section remote-account-settings">
      <summary>{t.accounts}</summary>
      {accounts.accounts.length === 0 && <p>{t.noAccounts}</p>}
      {accounts.accounts.map((account) => <div className="remote-account" key={account.id}>
        <strong>{account.login}</strong><small>{account.host}</small>
        <button type="button" disabled={working || !accounts.credentialStorageAvailable} onClick={() => {
          setAccountHost(account.host); setAccountLogin(account.login); setSecret(""); setEditingAccount(true);
        }}>{t.editAccount}</button>
        <button type="button" disabled={working} onClick={() => void perform("remove", async () => { await platform.remoteGit.removeAccount(account.id); await refreshAccounts(); await refresh(); })}>{t.remove}</button>
      </div>)}
      {accounts.accounts.length > 0 && <p>{t.removeHelp}</p>}
      {editingAccount && accounts.credentialStorageAvailable ? <form className="remote-add-form" onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        const input = { host: accountHost, login: accountLogin.trim(), secret };
        setSecret("");
        void perform("saveAccount", async () => {
          await platform.remoteGit.saveAccount(input);
          if (mounted.current) { setEditingAccount(false); setAccountLogin(""); setMessage("accountSaved"); }
          await refreshAccounts(); await refresh();
        });
      }}>
        <label>{t.provider}<select value={accountHost} disabled={working} onChange={(event) => { setAccountHost(event.target.value); setSecret(""); }}>
          <option value="gitee.com">Gitee</option><option value="github.com">GitHub</option>
        </select></label>
        <label>{t.username}<input required autoComplete="off" spellCheck={false} value={accountLogin} maxLength={128} disabled={working} onChange={(event) => setAccountLogin(event.target.value)} /></label>
        <label>{accountHost === "github.com" ? t.token : t.password}<input required type="password" autoComplete="new-password" value={secret} disabled={working} onChange={(event) => setSecret(event.target.value)} /></label>
        <p>{accountHost === "github.com" ? t.githubHelp : t.giteeHelp}</p>
        <p>{t.storageHelp}</p>
        <div className="remote-actions"><button type="submit" disabled={working || !accountLogin.trim() || !secret}>{busy === "saveAccount" ? t.busy : t.saveAccount}</button>
          <button type="button" disabled={working} onClick={() => { setSecret(""); setEditingAccount(false); }}>{t.cancel}</button></div>
      </form> : <><button type="button" disabled={working || !accounts.credentialStorageAvailable} onClick={() => {
        setAccountHost("gitee.com"); setAccountLogin(""); setSecret(""); setEditingAccount(true);
      }}>{t.addAccount}</button><p>{accounts.credentialStorageAvailable ? t.storageHelp : t.storageUnavailable}</p></>}
    </details>
  </section>;
}
