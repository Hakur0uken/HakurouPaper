import { useCallback, useEffect, useRef, useState } from "react";
import type { UiText } from "../../i18n";
import { platform, type GitInstallationStatus, type VersionAuthorIdentity, type VersionChange, type VersionDocumentScope, type VersionRecord, type VersionRepositoryInfo } from "../../platform";
import type { FeatureWorkspaceProps } from "../registry";
import { RemoteSyncWorkspace } from "../remote-sync/RemoteSyncWorkspace";
import "./versionIdentity.css";

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

export function VersionControlWorkspace(props: FeatureWorkspaceProps) {
  const { document, text, onSaveDocument, repositoryBusy, runRepositoryOperation, showRevisionChanges, onShowRevisionChangesChange, onVersionStateChanged, onOpenVersionDiff, onOpenVersionHistoryComparison } = props;
  const [state, setState] = useState<VersionControlState>(() => document.path ? { kind: "checking" } : { kind: "unsaved" });
  const [changesState, setChangesState] = useState<ChangesState>({ kind: "idle" });
  const [historyState, setHistoryState] = useState<HistoryState>({ kind: "idle" });
  const [identity, setIdentity] = useState<VersionAuthorIdentity>({});
  const [identityDraft, setIdentityDraft] = useState("");
  const [editingIdentity, setEditingIdentity] = useState(false);
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
        setIdentityDraft(identityResult.value.nickname ?? "");
      } else {
        setIdentity({});
      }
    } catch (error) {
      if (requestId === requestIdRef.current) setState({ kind: "error", message: String(error) });
    }
  }, [document.assetFolder, document.headRevisionEpoch, document.path, document.workingTreeEpoch, text.versionGitUnavailable]);

  useEffect(() => {
    void inspect();
  }, [inspect]);

  const enableVersionManagement = useCallback(async () => {
    if (!document.path) return;
    const documentPath = document.path;
    setIsInitialising(true);
    try {
      await runRepositoryOperation(async () => {
        await platform.versionControl.initRepository({
          documentPath,
          assetFolder: document.assetFolder,
        });
        await inspect();
        onVersionStateChanged();
      });
    } catch (error) {
      setState({ kind: "error", message: String(error) });
    } finally {
      setIsInitialising(false);
    }
  }, [document.assetFolder, document.path, inspect, onVersionStateChanged, runRepositoryOperation]);

  const openGitInstallPage = useCallback(async () => {
    try {
      await platform.links.openExternal(gitInstallUrl);
    } catch (error) {
      setState({ kind: "error", message: String(error) });
    }
  }, []);

  const saveIdentity = useCallback(async () => {
    if (!document.path || isSavingIdentity) return;
    const documentPath = document.path;
    setIsSavingIdentity(true);
    setIdentityMessage(null);
    try {
      await runRepositoryOperation(async () => {
        await platform.versionControl.configureIdentity({
          documentPath,
          assetFolder: document.assetFolder,
          nickname: identityDraft.trim(),
        });
        setEditingIdentity(false);
        await inspect();
      });
    } catch (error) {
      setIdentityMessage(String(error));
    } finally {
      setIsSavingIdentity(false);
    }
  }, [document.assetFolder, document.path, identityDraft, inspect, isSavingIdentity, runRepositoryOperation]);

  const createVersion = useCallback(async () => {
    if (!document.path || isCreatingVersion) return false;
    const message = versionMessage.trim();
    if (!message) {
      setCreateMessage(text.versionMessageRequired);
      return false;
    }
    setCreateMessage(null);
    setIsCreatingVersion(true);
    try {
      const saved = await onSaveDocument();
      if (!saved) return false;
      await platform.versionControl.createVersion({
        documentPath: document.path,
        assetFolder: document.assetFolder,
        message,
      });
      onVersionStateChanged();
      setVersionMessage("");
      setCreateMessage(text.versionCreated);
      await inspect();
      return true;
    } catch (error) {
      setCreateMessage(String(error));
      return false;
    } finally {
      setIsCreatingVersion(false);
    }
  }, [document.assetFolder, document.path, inspect, isCreatingVersion, onSaveDocument, onVersionStateChanged, text.versionCreated, text.versionMessageRequired, versionMessage]);

  // Git returns only the current manuscript scope (Markdown, its asset folder,
  // and hakurou.json). Present that as one logical manuscript change instead
  // of hiding non-Markdown resource changes behind `isDocument`.
  const manuscriptChanges = changesState.kind === "ready" ? changesState.changes : [];
  const manuscriptChange = manuscriptChanges.find((change) => change.isDocument) ?? manuscriptChanges[0];
  const hasIdentity = Boolean(identity.nickname);
  const hasDocumentChanges = document.isDirty || (changesState.kind === "ready" && changesState.changes.length > 0);
  const canCreateVersion = hasIdentity && changesState.kind === "ready" && hasDocumentChanges && versionMessage.trim().length > 0 && !isCreatingVersion && !repositoryBusy;

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
          <button type="button" className="is-primary" disabled={isInitialising || repositoryBusy} onClick={() => void enableVersionManagement()}>
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
          {changesState.kind === "ready" && <span>{manuscriptChanges.length > 0 ? 1 : 0}</span>}
        </div>
        <label className="version-change-visibility"><input type="checkbox" checked={showRevisionChanges} onChange={(event) => onShowRevisionChangesChange(event.target.checked)} /> {text.versionShowRevisionChanges}</label>
        {document.isDirty && <p className="version-unsaved-content-notice">{text.versionUnsavedContentNotice}</p>}
        {changesState.kind === "loading" && <p className="version-change-loading">{text.versionDiffLoading}</p>}
        {changesState.kind === "error" && <p className="version-change-error">{changesState.message}</p>}
        {changesState.kind === "ready" && (manuscriptChanges.length === 0
          ? <p className="version-no-changes">{text.versionNoChanges}</p>
          : <div className="version-change-list">
            {manuscriptChange && <button type="button" className="version-change-item is-modified" onClick={() => onOpenVersionDiff(manuscriptChange)}>
              <span className="version-change-symbol" aria-hidden="true">●</span>
              <span className="version-change-copy">
                <strong>{filename(document.path ?? manuscriptChange.path)}</strong>
                <small>{text.versionManuscriptChanged}</small>
              </span>
            </button>}
          </div>)}
      </section>

      <section className="version-control-card version-author-card">
        <h2>{text.versionAuthorInformation}</h2>
        <p>{text.versionNicknameHelp}</p>
        {!hasIdentity || editingIdentity ? <>
        <label className="version-description-field"><span>{text.versionNickname}</span><input value={identityDraft} maxLength={80} autoComplete="off" disabled={repositoryBusy} onChange={(event) => { setIdentityDraft(event.target.value); setIdentityMessage(null); }} /></label>
        <div className="version-control-actions"><button type="button" className="is-primary" disabled={isSavingIdentity || repositoryBusy || !identityDraft.trim()} onClick={() => void saveIdentity()}>{isSavingIdentity ? text.versionSavingAuthor : text.versionSaveAuthor}</button>{hasIdentity && <button type="button" disabled={repositoryBusy} onClick={() => { setEditingIdentity(false); setIdentityDraft(identity.nickname ?? ""); }}>{text.cancel}</button>}</div>
        </> : <div className="version-nickname-summary"><strong>{identity.nickname}</strong><button type="button" disabled={repositoryBusy} onClick={() => setEditingIdentity(true)}>{text.versionEditNickname}</button></div>}
        {identityMessage && <p className="version-create-message is-error" role="alert">{identityMessage}</p>}
      </section>

      <section className="version-control-card version-create-card">
        <h2>{text.versionCreate}</h2>
        <label className="version-description-field">
          <span>{text.versionDescription}</span>
          <input value={versionMessage} disabled={repositoryBusy} maxLength={160} onChange={(event) => { setVersionMessage(event.target.value); setCreateMessage(null); }} placeholder={text.versionDescriptionHint} />
        </label>
        <p>{text.versionDescriptionHelp}</p>
        {createMessage && <p className={`version-create-message ${createMessage === text.versionCreated ? "is-success" : "is-error"}`} role="status">{createMessage}</p>}
        <div className="version-control-actions">
          <button type="button" className="is-primary" disabled={!canCreateVersion} onClick={() => void runRepositoryOperation(async () => { await createVersion(); }).catch((error) => setCreateMessage(String(error)))}>
            {isCreatingVersion ? text.versionCreatingVersion : text.versionCreateVersion}
          </button>
        </div>
      </section>
    </>}
    <RemoteSyncWorkspace {...props} changesReady={changesState.kind === "ready"} hasDocumentChanges={hasDocumentChanges} canCreateVersion={canCreateVersion} onCreateVersion={createVersion} versionDescription={versionMessage.trim()} />
    {state.kind === "repository" && <>
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
