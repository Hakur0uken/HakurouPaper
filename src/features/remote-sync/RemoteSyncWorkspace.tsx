import { useCallback, useEffect, useRef, useState } from "react";
import { platform, type GitAccountStatus, type RemoteAction, type RemoteRepository } from "../../platform";
import type { FeatureWorkspaceProps } from "../registry";
import "./remoteSync.css";

export function RemoteSyncWorkspace({ document, text, hasUnsavedDocuments, onDiskDocumentsChanged, onVersionStateChanged }: FeatureWorkspaceProps) {
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
  const [confirmPush, setConfirmPush] = useState(false);
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
        setSelected((current) => result.remotes.some((r) => r.name === current) ? current : result.remotes[0]?.name ?? "");
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

  useEffect(() => { setRepository(null); setConfirmPush(false); setError(null); setMessage(null); setAdding(false); setName("origin"); setUrl(""); void refresh(); }, [document.path, refresh]);
  useEffect(() => { void refresh(); }, [document.headRevisionEpoch, document.workingTreeEpoch, refresh]);

  const perform = useCallback(async (operation: string, work: () => Promise<void>) => {
    if (busy) return;
    setBusy(operation); setError(null); setMessage(null); setConfirmPush(false);
    try { await work(); }
    catch (failure) { if (mounted.current) setError(String(failure)); }
    finally { if (mounted.current) setBusy(null); }
  }, [busy]);

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

  const usesHttps = remote?.pushUrl.startsWith("https://") ?? false;
  const remoteAccounts = accounts.accounts.filter((account) => usesHttps && account.host === remote?.host);
  const disabled = Boolean(busy || !remote || !repository?.branch || !repository.hasCommits || remote.accountIssue);
  const diverged = Boolean(remote?.ahead && remote.behind);

  return <div className="feature-workspace remote-sync-workspace">
    <header className="feature-workspace-header"><h1>{t.title}</h1><p>{t.description}</p><small>{t.experimental}</small></header>
    <p className="remote-intro">{t.gettingStarted}</p>
    {error && <p className="remote-feedback is-error" role="alert">{error}</p>}
    {message && <p className="remote-feedback" role="status">{t[message]}</p>}
    {!repository && <section className="remote-section"><p>{t.openFirst}</p><button type="button" disabled={Boolean(busy)} onClick={() => void perform("refresh", async () => { await refresh(); await refreshAccounts(); })}>{t.refresh}</button></section>}
    {repository && <>
      <section className="remote-section">
        <div className="remote-heading"><h2>{t.repository}</h2><button type="button" disabled={Boolean(busy)} onClick={() => void perform("refresh", refresh)}>{t.refresh}</button></div>
        <p className="remote-path">{repository.repositoryRoot}</p>
        <p>{t.branch}：<strong>{repository.branch ?? t.detached}</strong></p>
        {repository.remotes.length > 0 && <label>{t.remote}<select disabled={Boolean(busy)} value={remote?.name ?? ""} onChange={(event) => { setSelected(event.target.value); setConfirmPush(false); setMessage(null); }}>{repository.remotes.map((item) => <option key={item.name} value={item.name}>{item.name} · {item.host}</option>)}</select></label>}
        {remote && <>
          <p className="remote-path">{remote.pushUrl}</p>
          <p>{repository.branch} → {remote.targetBranch}</p>
          <label>{t.account}<select disabled={Boolean(busy)} value={remote.accountIssue ? "" : remote.accountId ?? "system"} onChange={(event) => void perform("account", async () => {
            const path = document.path!;
            const result = await platform.remoteGit.bindAccount({ documentPath: path, remote: remote.name, accountId: event.target.value });
            if (mounted.current && activePath.current === path) setRepository(result);
          })}>
            {remote.accountIssue && <option value="" disabled>{t.chooseAccount}</option>}
            <option value="system">{t.system}</option>
            {remoteAccounts.map((account) => <option key={account.id} value={account.id}>{account.login} · {account.host}</option>)}
          </select></label>
          {!usesHttps && <p>{t.sshHelp}</p>}
          {remote.accountIssue && <p className="remote-feedback is-error">{remote.accountIssue}</p>}
          <p>{remote.ahead !== null && remote.behind !== null ? t.counts(remote.ahead, remote.behind) : t.unknown}</p>
          <p className="remote-scope">{t.scope}</p>
          {!repository.hasCommits && <p>{t.noCommits}</p>}
          {hasUnsavedDocuments ? <p className="remote-notice">{t.unsaved}</p> : repository.dirty && <p className="remote-notice">{t.dirty}</p>}
          {diverged && <p className="remote-notice">{t.divergent}</p>}
          <div className="remote-actions">
            <button type="button" disabled={disabled} onClick={() => synchronize("fetch")}>{busy === "fetch" ? t.fetching : t.fetch}</button>
            <button type="button" disabled={disabled || hasUnsavedDocuments || repository.dirty || diverged} onClick={() => synchronize("pull")}>{busy === "pull" ? t.pulling : t.pull}</button>
            <button type="button" disabled={disabled || diverged} onClick={() => setConfirmPush(true)}>{busy === "push" ? t.pushing : t.push}</button>
          </div>
          {confirmPush && <div className="remote-confirm" role="group" aria-label={t.confirmPush}><p>{remote.pushUrl}<br />{repository.branch} → {remote.targetBranch}</p><button type="button" disabled={Boolean(busy)} onClick={() => synchronize("push")}>{t.confirmPush}</button><button type="button" onClick={() => setConfirmPush(false)}>{t.cancel}</button></div>}
        </>}
        {!adding && repository.remotes.length > 0 && <button className="remote-add-toggle" type="button" onClick={() => { setAdding(true); setName("gitee"); }}>{t.addRemote}</button>}
        {(adding || repository.remotes.length === 0) && <form className="remote-add-form" onSubmit={(event) => {
          event.preventDefault();
          void perform("add", async () => {
            const path = document.path!;
            const result = await platform.remoteGit.add({ documentPath: path, name: name.trim(), url: url.trim() });
            if (mounted.current && activePath.current === path) { setRepository(result); setSelected(name.trim()); setUrl(""); setAdding(false); }
          });
        }}><label>{t.remoteName}<input required value={name} disabled={Boolean(busy)} onChange={(event) => setName(event.target.value)} /></label><label>{t.remoteUrl}<input required value={url} disabled={Boolean(busy)} placeholder="https://gitee.com/owner/paper.git" onChange={(event) => setUrl(event.target.value)} /></label><p>{t.addHelp}</p><button disabled={Boolean(busy) || !url.trim() || !name.trim()} type="submit">{busy === "add" ? t.busy : t.connect}</button></form>}
      </section>
    </>}
    <section className="remote-section">
      <h2>{t.accounts}</h2>
      {accounts.accounts.length === 0 && <p>{t.noAccounts}</p>}
      {accounts.accounts.map((account) => <div className="remote-account" key={account.id}>
        <strong>{account.login}</strong><small>{account.host}</small>
        <button type="button" disabled={Boolean(busy) || !accounts.credentialStorageAvailable} onClick={() => {
          setAccountHost(account.host); setAccountLogin(account.login); setSecret(""); setEditingAccount(true);
        }}>{t.editAccount}</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void perform("remove", async () => { await platform.remoteGit.removeAccount(account.id); await refreshAccounts(); await refresh(); })}>{t.remove}</button>
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
        <label>{t.provider}<select value={accountHost} disabled={Boolean(busy)} onChange={(event) => { setAccountHost(event.target.value); setSecret(""); }}>
          <option value="gitee.com">Gitee</option><option value="github.com">GitHub</option>
        </select></label>
        <label>{t.username}<input required autoComplete="off" spellCheck={false} value={accountLogin} maxLength={128} disabled={Boolean(busy)} onChange={(event) => setAccountLogin(event.target.value)} /></label>
        <label>{accountHost === "github.com" ? t.token : t.password}<input required type="password" autoComplete="new-password" value={secret} disabled={Boolean(busy)} onChange={(event) => setSecret(event.target.value)} /></label>
        <p>{accountHost === "github.com" ? t.githubHelp : t.giteeHelp}</p>
        <p>{t.storageHelp}</p>
        <div className="remote-actions"><button type="submit" disabled={Boolean(busy) || !accountLogin.trim() || !secret}>{busy === "saveAccount" ? t.busy : t.saveAccount}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => { setSecret(""); setEditingAccount(false); }}>{t.cancel}</button></div>
      </form> : <><button type="button" disabled={Boolean(busy) || !accounts.credentialStorageAvailable} onClick={() => {
        setAccountHost("gitee.com"); setAccountLogin(""); setSecret(""); setEditingAccount(true);
      }}>{t.addAccount}</button><p>{accounts.credentialStorageAvailable ? t.storageHelp : t.storageUnavailable}</p></>}
    </section>
  </div>;
}
