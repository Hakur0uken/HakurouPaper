import { useEffect, useRef } from "react";
import type { SoftwareUpdateController, UpdateState } from "./controller";
import type { SoftwareUpdateText } from "./text";
import "./softwareUpdate.css";

export function SoftwareUpdateDialog({ state, controller, text, block }: { state: UpdateState; controller: SoftwareUpdateController; text: SoftwareUpdateText; block: "unsaved" | "busy" | null }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const installing = state.phase === "installing";
  useEffect(() => {
    const dialog = dialogRef.current;
    if (state.open && dialog && !dialog.open) dialog.showModal();
    if (!state.open && dialog?.open) dialog.close();
  }, [state.open]);
  const error = state.problem ? {
    check: text.checkFailed, download: text.downloadFailed, install: text.installFailed,
    unsaved: text.saveFirst, busy: text.busy, open: text.openFailed,
  }[state.problem] : null;
  const percent = state.total && state.total > 0 ? Math.min(100, Math.floor(state.downloaded / state.total * 100)) : undefined;
  return <dialog ref={dialogRef} className="software-update-dialog" aria-labelledby="software-update-title" onCancel={(event) => { event.preventDefault(); controller.dismiss(); }}>
    <header><span className="software-update-eyebrow">HakurouPaper</span><h2 id="software-update-title">{state.update ? text.available(state.update.version) : text.title}</h2></header>
    {state.update && <>
      <p className="software-update-versions">{text.versions(state.currentVersion, state.update.version)}</p>
      <section className="software-update-notes" aria-label={text.notes}><h3>{text.notes}</h3><p>{state.update.notes || text.noNotes}</p></section>
    </>}
    <div role="status" aria-live="polite">
      {state.phase === "checking" && <p>{text.checking}</p>}
      {state.phase === "current" && <p>{text.current(state.currentVersion)}</p>}
      {state.phase === "downloading" && <div className="software-update-progress"><p>{text.downloading} {percent === undefined ? `${(state.downloaded / 1024 / 1024).toFixed(1)} MB` : `${percent}%`}</p><progress aria-label={text.downloading} max={100} value={percent} /></div>}
      {state.phase === "ready" && <p>{text.ready}</p>}
      {installing && <p>{text.installing}</p>}
    </div>
    {state.update?.kind === "manual" && <p>{text.manual}</p>}
    {state.update?.kind === "in-app" && <p className="software-update-help">{text.installHelp}</p>}
    {state.phase === "ready" && block && <p className="software-update-error" role="status">{block === "unsaved" ? text.saveFirst : text.busy}</p>}
    {error && !(state.phase === "ready" && block === state.problem) && <p className="software-update-error" role="alert">{error}</p>}
    <footer>
      <button type="button" disabled={installing} onClick={() => controller.dismiss()}>{state.update ? text.later : text.close}</button>
      {(state.phase === "error" || state.phase === "current") && <button type="button" onClick={() => void controller.check(true)}>{text.retry}</button>}
      {(state.phase === "error" || state.problem || state.update?.kind === "manual") && !installing && <button type="button" onClick={() => void controller.openReleasePage()}>{text.releasePage}</button>}
      {state.phase === "available" && state.update?.kind === "in-app" && <button type="button" className="is-primary" onClick={() => void controller.download()}>{text.download}</button>}
      {state.phase === "ready" && <button type="button" className="is-primary" disabled={Boolean(block)} onClick={() => void controller.install()}>{text.install}</button>}
    </footer>
  </dialog>;
}
