import { useCallback, useEffect, useRef, useState } from "react";
import type { UiText } from "../../i18n";
import { platform, type GitInstallationStatus, type VersionAuthorIdentity, type VersionChange, type VersionDocumentScope, type VersionRecord, type VersionRepositoryInfo } from "../../platform";
import type { FeatureWorkspaceProps } from "../registry";

type VersionControlState =
  | { kind: "unsaved" }
  | { kind: "checking" }
  | { kind: "git-unavailable"; message: string }
  | { kind: "not-enabled"; git: GitInstallationStatus; scope: VersionDocumentScope }
  | { kind: "repository"; git: GitInstallationStatus; repository: VersionRepositoryInfo }
  | { kind: "error"; message: string };

type ChangesState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; changes: VersionChange[] }
  | { kind: "error"; message: string };

type HistoryState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; versions: VersionRecord[] }
  | { kind: "error"; message: string };

const gitInstallUrl = "https://git-scm.com/downloads";

function filename(path: string) {
  return path.split(/[\\/]/).pop() || path;
}

function versionTime(timestamp: string) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

function ScopeList({ scope, assetFolder, text }: { scope: VersionDocumentScope; assetFolder: string | null; text: UiText }) {
  return <ul className="version-scope-list">
    <li>{text.versionIncludesMarkdown(filename(scope.documentPath))}</li>
    {scope.assetFolderPath && assetFolder && <li>{text.versionIncludesAssets(assetFolder)}</li>}
  </ul>;
}

function changeLabel(change: VersionChange, text: UiText) {
  switch (change.kind) {
    case "added":
    case "untracked": return text.versionChangeAdded;
    case "deleted": return text.versionChangeDeleted;
    case "renamed": return text.versionChangeRenamed;
    default: return text.versionChangeModified;
  }
}

function changeSymbol(change: VersionChange) {
  switch (change.kind) {
    case "added":
    case "untracked": return "＋";
    case "deleted": return "－";
    case "renamed": return "↔";
    default: return "●";
  }
}

export function VersionControlWorkspace({ document, text, onSaveDocument, showRevisionChanges, onShowRevisionChangesChange, onVersionStateChanged, onOpenVersionDiff, onOpenVersionHistoryComparison }: FeatureWorkspaceProps) {
  const [state, setState] = useState<VersionControlState>(() => document.path ? { kind: "checking" } : { kind: "unsaved" });
  const [changesState, setChangesState] = useState<ChangesState>({ kind: "idle" });
  const [historyState, setHistoryState] = useState<HistoryState>({ kind: "idle" });
  const [identity, setIdentity] = useState<VersionAuthorIdentity>({});
  const [identityDraft, setIdentityDraft] = useState({ name: "", email: "" });
  const [isSavingIdentity, setIsSavingIdentity] = useState(false);
  const [identityMessage, setIdentityMessage] = useState<string | null>(null);
  const [isInitialising, setIsInitialising] = useState(false);
  const [versionMessage, setVersionMessage] = useState("");
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const inspect = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!document.path) {
      setState({ kind: "unsaved" });
      setChangesState({ kind: "idle" });
      setHistoryState({ kind: "idle" });
      setIdentity({});
      return;
    }
    setState({ kind: "checking" });
    setChangesState({ kind: "idle" });
    setHistoryState({ kind: "idle" });
    try {
      const git = await platform.versionControl.inspectGit();
      if (requestId !== requestIdRef.current) return;
      if (!git.available) {
        setState({ kind: "git-unavailable", message: git.message ?? text.versionGitUnavailable });
        return;
      }
      const repository = await platform.versionControl.inspectRepository({
        documentPath: document.path,
        assetFolder: document.assetFolder,
      });
      if (requestId !== requestIdRef.current) return;
      if (!repository.isRepository) {
        setState({ kind: "not-enabled", git, scope: repository.documentScope });
        return;
      }
      setState({ kind: "repository", git, repository });
      setChangesState({ kind: "loading" });
      setHistoryState({ kind: "loading" });
      const [changesResult, historyResult, identityResult] = await Promise.allSettled([
        platform.versionControl.getChanges({ documentPath: document.path, assetFolder: document.assetFolder }),
        platform.versionControl.getHistory({ documentPath: document.path, assetFolder: document.assetFolder, limit: 30 }),
        platform.versionControl.inspectIdentity({ documentPath: document.path, assetFolder: document.assetFolder }),
      ]);
      if (requestId !== requestIdRef.current) return;
      setChangesState(changesResult.status === "fulfilled"
        ? { kind: "ready", changes: changesResult.value }
        : { kind: "error", message: String(changesResult.reason) });
      setHistoryState(historyResult.status === "fulfilled"
        ? { kind: "ready", versions: historyResult.value }
        : { kind: "error", message: String(historyResult.reason) });
      if (identityResult.status === "fulfilled") {
        setIdentity(identityResult.value);
        setIdentityDraft({ name: identityResult.value.name ?? "", email: identityResult.value.email ?? "" });
      } else {
        setIdentity({});
      }
    } catch (error) {
      if (requestId === requestIdRef.current) setState({ kind: "error", message: String(error) });
    }
  }, [document.assetFolder, document.path, document.versionStatusRevision, text.versionGitUnavailable]);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  const enableVersionManagement = useCallback(async () => {
    if (!document.path) return;
    setIsInitialising(true);
    try {
      await platform.versionControl.initRepository({
        documentPath: document.path,
        assetFolder: document.assetFolder,
      });
      await inspect();
    } catch (error) {
      setState({ kind: "error", message: String(error) });
    } finally {
      setIsInitialising(false);
    }
  }, [document.assetFolder, document.path, inspect]);

  const openGitInstallPage = useCallback(async () => {
    try {
      await platform.links.openExternal(gitInstallUrl);
    } catch (error) {
      setState({ kind: "error", message: String(error) });
    }
  }, []);

  const saveIdentity = useCallback(async () => {
    if (!document.path || isSavingIdentity) return;
    setIsSavingIdentity(true);
    setIdentityMessage(null);
    try {
      await platform.versionControl.configureIdentity({
        documentPath: document.path,
        assetFolder: document.assetFolder,
        name: identityDraft.name,
        email: identityDraft.email,
      });
      await inspect();
    } catch (error) {
      setIdentityMessage(String(error));
    } finally {
      setIsSavingIdentity(false);
    }
  }, [document.assetFolder, document.path, identityDraft.email, identityDraft.name, inspect, isSavingIdentity]);

  const createVersion = useCallback(async () => {
    if (!document.path || isCreatingVersion) return;
    const message = versionMessage.trim();
    if (!message) {
      setCreateMessage(text.versionMessageRequired);
      return;
    }
    setCreateMessage(null);
    setIsCreatingVersion(true);
    try {
      const saved = await onSaveDocument();
      if (!saved) return;
      await platform.versionControl.createVersion({
        documentPath: document.path,
        assetFolder: document.assetFolder,
        message,
      });
      onVersionStateChanged();
      setVersionMessage("");
      setCreateMessage(text.versionCreated);
      await inspect();
    } catch (error) {
      setCreateMessage(String(error));
    } finally {
      setIsCreatingVersion(false);
    }
  }, [document.assetFolder, document.path, inspect, isCreatingVersion, onSaveDocument, onVersionStateChanged, text.versionCreated, text.versionMessageRequired, versionMessage]);

  const documentChanges = changesState.kind === "ready"
    ? changesState.changes.filter((change) => change.isDocument)
    : [];
  const hasIdentity = Boolean(identity.name && identity.email);
  const canCreateVersion = hasIdentity && changesState.kind === "ready" && changesState.changes.length > 0 && versionMessage.trim().length > 0 && !isCreatingVersion;

  return <div className="feature-workspace version-control-workspace">
    <header className="feature-workspace-header">
      <h1>{text.versionManagement}</h1>
      <p>{text.versionManagementDescription}</p>
    </header>

    {state.kind === "unsaved" && <section className="version-control-card version-control-message" role="status"><p>{text.versionRequiresSavedDocument}</p></section>}

    {state.kind === "checking" && <section className="version-control-status is-checking" aria-live="polite">
      <span className="version-control-status-dot" />
      <strong>{text.versionCheckingGit}</strong>
    </section>}

    {state.kind === "git-unavailable" && <section className="version-control-status is-unavailable" aria-live="polite">
      <span className="version-control-status-dot" />
      <div>
        <strong>{text.versionGitUnavailable}</strong>
        <p>{text.versionGitUnavailableDescription}</p>
        {state.message !== text.versionGitUnavailable && <p className="version-control-detail">{state.message}</p>}
      </div>
      <div className="version-control-status-actions">
        <button type="button" onClick={() => void openGitInstallPage()}>{text.getGit}</button>
        <button type="button" onClick={() => void inspect()}>{text.checkGit}</button>
      </div>
    </section>}

    {state.kind === "not-enabled" && <>
      <section className="version-control-status" aria-live="polite">
        <span className="version-control-status-dot" />
        <strong>{text.versionGitAvailable(state.git.version)}</strong>
        <div className="version-control-status-actions"><button type="button" onClick={() => void inspect()}>{text.checkGit}</button></div>
      </section>
      <section className="version-control-card">
        <h2>{text.versionNotEnabled}</h2>
        <p>{text.versionScope}</p>
        <ScopeList scope={state.scope} assetFolder={document.assetFolder} text={text} />
        <div className="version-control-actions">
          <button type="button" className="is-primary" disabled={isInitialising} onClick={() => void enableVersionManagement()}>
            {isInitialising ? text.enablingVersionManagement : text.enableVersionManagement}
          </button>
        </div>
      </section>
    </>}

    {state.kind === "repository" && <>
      <section className="version-control-status" aria-live="polite">
        <span className="version-control-status-dot" />
        <strong>{text.versionEnabled}</strong>
        <div className="version-control-status-actions"><button type="button" onClick={() => void inspect()}>{text.versionRefresh}</button></div>
      </section>
      <section className="version-control-card version-change-card">
        <div className="version-change-card-heading">
          <h2>{text.versionCurrentChanges}</h2>
          {changesState.kind === "ready" && <span>{documentChanges.length}</span>}
        </div>
        <label className="version-change-visibility"><input type="checkbox" checked={showRevisionChanges} onChange={(event) => onShowRevisionChangesChange(event.target.checked)} /> {text.versionShowRevisionChanges}</label>
        {document.isDirty && <p className="version-unsaved-content-notice">{text.versionUnsavedContentNotice}</p>}
        {changesState.kind === "loading" && <p className="version-change-loading">{text.versionDiffLoading}</p>}
        {changesState.kind === "error" && <p className="version-change-error">{changesState.message}</p>}
        {changesState.kind === "ready" && (documentChanges.length === 0
          ? <p className="version-no-changes">{changesState.changes.length === 0 ? text.versionNoChanges : text.versionNoDocumentChanges}</p>
          : <div className="version-change-list">
            {documentChanges.map((change) => <button type="button" key={`${change.oldPath ?? ""}-${change.path}`} className={`version-change-item is-${change.kind}`} onClick={() => onOpenVersionDiff(change)}>
              <span className="version-change-symbol" aria-hidden="true">{changeSymbol(change)}</span>
              <span className="version-change-copy">
                <strong>{change.kind === "renamed" && change.oldPath ? <>{filename(change.oldPath)} <i>→</i> {filename(change.path)}</> : filename(change.path)}</strong>
                <small>{changeLabel(change, text)}</small>
              </span>
            </button>)}
          </div>)}
      </section>

      {!hasIdentity && <section className="version-control-card version-author-card">
        <h2>{text.versionAuthorInformation}</h2>
        <label className="version-description-field"><span>{text.versionAuthorName}</span><input value={identityDraft.name} onChange={(event) => setIdentityDraft((current) => ({ ...current, name: event.target.value }))} /></label>
        <label className="version-description-field"><span>{text.versionAuthorEmail}</span><input type="email" value={identityDraft.email} onChange={(event) => setIdentityDraft((current) => ({ ...current, email: event.target.value }))} /></label>
        {identityMessage && <p className="version-create-message is-error" role="alert">{identityMessage}</p>}
        <div className="version-control-actions"><button type="button" className="is-primary" disabled={isSavingIdentity} onClick={() => void saveIdentity()}>{isSavingIdentity ? text.versionSavingAuthor : text.versionSaveAuthor}</button></div>
      </section>}

      <section className="version-control-card version-create-card">
        <h2>{text.versionCreate}</h2>
        <label className="version-description-field">
          <span>{text.versionDescription}</span>
          <input value={versionMessage} maxLength={160} onChange={(event) => { setVersionMessage(event.target.value); setCreateMessage(null); }} placeholder={text.versionDescriptionHint} />
        </label>
        <p>{text.versionDescriptionHelp}</p>
        {createMessage && <p className={`version-create-message ${createMessage === text.versionCreated ? "is-success" : "is-error"}`} role="status">{createMessage}</p>}
        <div className="version-control-actions">
          <button type="button" className="is-primary" disabled={!canCreateVersion} onClick={() => void createVersion()}>
            {isCreatingVersion ? text.versionCreatingVersion : text.versionCreateVersion}
          </button>
        </div>
      </section>

      <section className="version-control-card version-history-card">
        <h2>{text.versionHistory}</h2>
        {historyState.kind === "loading" && <p className="version-change-loading">{text.versionHistoryLoading}</p>}
        {historyState.kind === "error" && <p className="version-change-error">{historyState.message}</p>}
        {historyState.kind === "ready" && (historyState.versions.length === 0
          ? <p className="version-no-changes">{text.versionHistoryEmpty}</p>
          : <div className="version-history-list">
            {historyState.versions.map((version) => <button type="button" className="version-history-item" key={version.id} onClick={() => onOpenVersionHistoryComparison(version)} title={version.shortId}>
              <strong>{version.message}</strong>
              <small>{version.authorName ? `${version.authorName} · ${versionTime(version.timestamp)}` : versionTime(version.timestamp)}</small>
            </button>)}
          </div>)}
      </section>

      <section className="version-control-card version-scope-card">
        <h2>{text.versionScope}</h2>
        <ScopeList scope={state.repository.documentScope} assetFolder={document.assetFolder} text={text} />
      </section>
    </>}

    {state.kind === "error" && <section className="version-control-status is-unavailable" role="alert">
      <span className="version-control-status-dot" />
      <div><strong>{text.versionManagement}</strong><p>{state.message}</p></div>
      <div className="version-control-status-actions"><button type="button" onClick={() => void inspect()}>{text.checkGit}</button></div>
    </section>}
  </div>;
}
