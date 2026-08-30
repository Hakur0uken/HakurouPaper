import { useCallback, useEffect, useState } from "react";
import { platform } from "../../platform";
import type { DocxExport, DocxExportProgress, FormulaExportMode, MathTypeStatus, PandocStatus } from "../../platform";
import type { UiText } from "../../i18n";
import type { FeatureWorkspaceProps } from "../registry";
import { createKaTeXFormulaPreviews, createMathTypeFormulaPayloads } from "../../formulaDelivery";
import { WordTemplateExperiment } from "./WordTemplateExperiment";

type PandocState =
  | { kind: "checking" }
  | { kind: "ready"; status: PandocStatus }
  | { kind: "unavailable"; message: string };

type MathTypeState =
  | { kind: "checking" }
  | { kind: "ready"; status: MathTypeStatus }
  | { kind: "unavailable"; message: string };

type WordLayoutSource = "currentStyle" | "referenceTemplate";

const lastWordTemplateStorageKey = "hakurou.paper.last-word-template";
const lastFormulaModeStorageKey = "hakurou.paper.last-formula-mode";
const pandocInstallUrl = "https://pandoc.org/installing.html";

function getLastWordTemplate() {
  const value = window.localStorage.getItem(lastWordTemplateStorageKey)?.trim();
  return value || null;
}

function getLastFormulaMode(): FormulaExportMode {
  const stored = window.localStorage.getItem(lastFormulaModeStorageKey);
  // The visible MathType choice deliberately uses MathType's own Word add-in
  // to convert Pandoc's OMML in one document-wide pass.  Preserve existing
  // users' prior MathType selection when moving them from the direct OLE path.
  return stored === "mathType" || stored === "mathTypeBatch" ? "mathTypeBatch" : "word";
}

function describeExportProgress(progress: DocxExportProgress, text: UiText) {
  switch (progress.phase) {
    case "preparing": return text.docxProgressPreparing;
    case "generating": return text.docxProgressGenerating;
    case "mathtypeAwaitingConvertDialog": return text.docxProgressAwaitingMathTypeConvertDialog;
    case "mathtypeConvertDialogReady": return text.docxProgressMathTypeConvertDialogReady;
    case "mathtypeManualConvertNeeded": return text.docxProgressManualMathTypeConvertNeeded;
    case "mathtypeBatchConverting": return text.docxProgressWaitingForMathType;
    case "mathtypeFormatting": return text.docxProgressFormattingMathType;
    case "mathtypeAwaitingFormatDialog": return text.docxProgressAwaitingMathTypeFormatDialog;
    case "mathtypeFormatDialogReady": return text.docxProgressMathTypeFormatDialogReady;
    case "mathtypeManualFormatNeeded": return text.docxProgressManualMathTypeFormatNeeded;
    case "mathtypeFormattingSkipped": return text.docxProgressMathTypeFormattingSkipped;
    case "mathtypeStartingBatch": return text.docxProgressStartingMathTypeBatch(progress.batchIndex ?? 1, progress.batchCount ?? 1);
    case "mathtypeRendering": return text.docxProgressRenderingMathType(progress.completed, progress.total, progress.batchIndex, progress.batchCount);
    case "saving": return text.docxProgressSaving;
  }
}

export function PandocWorkspace({ document, text }: FeatureWorkspaceProps) {
  const [pandocState, setPandocState] = useState<PandocState>({ kind: "checking" });
  const [mathTypeState, setMathTypeState] = useState<MathTypeState>({ kind: "checking" });
  const [formulaMode, setFormulaMode] = useState<FormulaExportMode>(getLastFormulaMode);
  const [layoutSource, setLayoutSource] = useState<WordLayoutSource>("currentStyle");
  const [templatePath, setTemplatePath] = useState<string | null>(null);
  const [lastTemplatePath, setLastTemplatePath] = useState<string | null>(getLastWordTemplate);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<DocxExportProgress | null>(null);
  const [isConfirmingManualMathTypeStep, setIsConfirmingManualMathTypeStep] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const checkPandoc = useCallback(async () => {
    setPandocState({ kind: "checking" });
    try {
      const status = await platform.files.inspectPandoc();
      if (status.available) setPandocState({ kind: "ready", status });
      else setPandocState({ kind: "unavailable", message: status.message ?? text.pandocUnavailable });
    } catch (error) {
      setPandocState({ kind: "unavailable", message: String(error) });
    }
  }, [text.pandocUnavailable]);

  const checkMathType = useCallback(async () => {
    setMathTypeState({ kind: "checking" });
    try {
      const status = await platform.files.inspectMathType();
      if (status.available) setMathTypeState({ kind: "ready", status });
      else setMathTypeState({ kind: "unavailable", message: status.message ?? text.mathTypeUnavailable });
      return status;
    } catch (error) {
      const message = String(error);
      setMathTypeState({ kind: "unavailable", message });
      return { available: false, message };
    }
  }, [text.mathTypeUnavailable]);

  useEffect(() => {
    void checkPandoc();
  }, [checkPandoc]);

  useEffect(() => {
    if (formulaMode === "mathType" || formulaMode === "mathTypeBatch") void checkMathType();
  }, [checkMathType, formulaMode]);

  const chooseTemplate = useCallback(async () => {
    const path = await platform.dialogs.openFile({
      title: text.chooseDocxTemplate,
      filter: { name: text.wordTemplate, extensions: ["docx"] },
    });
    if (path) setTemplatePath(path);
    if (path) setLayoutSource("referenceTemplate");
  }, [text.chooseDocxTemplate, text.wordTemplate]);

  const useLastTemplate = useCallback(() => {
    if (lastTemplatePath) {
      setTemplatePath(lastTemplatePath);
      setLayoutSource("referenceTemplate");
    }
  }, [lastTemplatePath]);

  const chooseLayoutSource = useCallback((source: WordLayoutSource) => {
    setLayoutSource(source);
  }, []);

  const chooseFormulaMode = useCallback((mode: FormulaExportMode) => {
    setFormulaMode(mode);
    window.localStorage.setItem(lastFormulaModeStorageKey, mode);
  }, []);

  const openPandocInstallPage = useCallback(async () => {
    try {
      await platform.links.openExternal(pandocInstallUrl);
    } catch (error) {
      setNotice(String(error));
    }
  }, []);

  const confirmManualMathTypeStep = useCallback(async () => {
    setIsConfirmingManualMathTypeStep(true);
    try {
      await platform.files.confirmManualMathTypeStep();
    } catch (error) {
      setNotice(`${text.docxExportFailed}\n${String(error)}`);
    } finally {
      setIsConfirmingManualMathTypeStep(false);
    }
  }, [text.docxExportFailed]);

  const exportDocx = useCallback(async () => {
    if (!document.path) {
      setNotice(text.docxExportRequiresSavedDocument);
      return;
    }
    if (formulaMode === "mathType" || formulaMode === "mathTypeBatch") {
      const status = await checkMathType();
      if (!status.available) {
        setNotice(`${text.mathTypeUnavailable}\n${status.message ?? ""}`.trim());
        return;
      }
    }
    const target = await platform.dialogs.saveFile({
      title: text.chooseDocxDestination,
      defaultPath: `${document.title || text.untitledDocument}.docx`,
      filter: { name: text.wordDocument, extensions: ["docx"] },
    });
    if (!target) return;

    let stopProgressListener: (() => void) | null = null;
    setIsExporting(true);
    setIsConfirmingManualMathTypeStep(false);
    setExportProgress({ phase: "preparing", completed: 0, total: 0, batchIndex: null, batchCount: null });
    setNotice(null);
    try {
      stopProgressListener = await platform.files.onDocxExportProgress(setExportProgress);
      const formulaPreviews = formulaMode === "mathType"
        ? createMathTypeFormulaPayloads(document.content)
        : formulaMode === "katexPreview"
          ? await createKaTeXFormulaPreviews(document.content)
          : undefined;
      const result: DocxExport = await platform.files.exportDocx({
        documentPath: document.path,
        content: document.content,
        assetFolder: document.assetFolder,
        assets: document.assets,
        outputPath: target.endsWith(".docx") ? target : `${target}.docx`,
        referenceDocPath: layoutSource === "referenceTemplate" ? templatePath : null,
        formulaMode,
        formulaPreviews,
      });
      if (layoutSource === "referenceTemplate" && templatePath) {
        window.localStorage.setItem(lastWordTemplateStorageKey, templatePath);
        setLastTemplatePath(templatePath);
      }
      setNotice(result.usedPreviewFallbackAssets > 0
        ? text.docxExportedWithPreviewFallback(result.outputPath, result.usedPreviewFallbackAssets)
        : text.docxExported(result.outputPath));
    } catch (error) {
      setNotice(`${text.docxExportFailed}\n${String(error)}`);
    } finally {
      stopProgressListener?.();
      setIsExporting(false);
      setIsConfirmingManualMathTypeStep(false);
      setExportProgress(null);
    }
  }, [checkMathType, document.assetFolder, document.assets, document.content, document.path, document.title, formulaMode, layoutSource, templatePath, text]);

  const pandocReady = pandocState.kind === "ready";
  const mathTypeSelected = formulaMode === "mathType" || formulaMode === "mathTypeBatch";
  const mathTypeReady = !mathTypeSelected || mathTypeState.kind === "ready";
  const layoutUsesReference = layoutSource === "referenceTemplate";
  const exportEnabled = pandocReady && mathTypeReady && Boolean(document.path)
    && (!layoutUsesReference || Boolean(templatePath)) && !isExporting;
  const manualMathTypeStepNeeded = exportProgress?.phase === "mathtypeManualConvertNeeded"
    || exportProgress?.phase === "mathtypeManualFormatNeeded";

  return <div className="feature-workspace pandoc-workspace">
    <header className="feature-workspace-header">
      <h1>{text.documentDelivery}</h1>
      <p>{text.documentDeliveryDescription}</p>
    </header>

    <section className={`pandoc-status is-${pandocState.kind}`} aria-live="polite">
      <span className="pandoc-status-dot" />
      <div>
        <strong>{pandocState.kind === "checking" ? text.pandocChecking : pandocState.kind === "ready" ? text.pandocReady(pandocState.status.version) : text.pandocUnavailable}</strong>
        {pandocState.kind === "unavailable" && <p>{pandocState.message}</p>}
      </div>
      <div className="pandoc-status-actions">
        {pandocState.kind === "unavailable" && <button type="button" onClick={() => void openPandocInstallPage()}>{text.downloadPandoc}</button>}
        <button type="button" onClick={() => void checkPandoc()} disabled={pandocState.kind === "checking"}>{text.checkPandoc}</button>
      </div>
    </section>

    <section className="pandoc-export-card pandoc-stable-export" aria-label={text.dailyWordExport}>
      <div className="pandoc-export-card-heading">
        <div><span className="pandoc-docx-icon">W</span><h2>{text.dailyWordExport}</h2></div>
        <span>.docx</span>
      </div>
      <p>{text.docxExportDescription}</p>
      <dl className="pandoc-document-summary">
        <div><dt>{text.exportDocument}</dt><dd>{document.title || text.untitledDocument}</dd></div>
        <div><dt>{text.layoutSource}</dt><dd>{layoutUsesReference ? text.referenceTemplate : text.currentStyle}</dd></div>
        {layoutUsesReference && <div><dt>{text.referenceTemplate}</dt><dd title={templatePath ?? undefined}>{templatePath ?? text.referenceTemplateNotSelected}</dd></div>}
      </dl>
      <fieldset className="pandoc-formula-options pandoc-layout-options">
        <legend>{text.layoutSource}</legend>
        <label className={layoutSource === "currentStyle" ? "is-selected" : undefined}>
          <input type="radio" name="word-layout-source" checked={layoutSource === "currentStyle"} onChange={() => chooseLayoutSource("currentStyle")} />
          <span><strong>{text.currentStyle}</strong><small>{text.currentStyleDescription}</small></span>
        </label>
        <label className={layoutUsesReference ? "is-selected" : undefined}>
          <input type="radio" name="word-layout-source" checked={layoutUsesReference} onChange={() => chooseLayoutSource("referenceTemplate")} />
          <span><strong>{text.referenceTemplate}</strong><small>{text.referenceTemplateDescription}</small></span>
        </label>
      </fieldset>
      {layoutUsesReference && <div className="pandoc-template-actions">
        <button type="button" onClick={() => void chooseTemplate()}>{text.chooseReferenceTemplate}</button>
        <button type="button" disabled={!lastTemplatePath} title={lastTemplatePath ?? text.noLastWordTemplate} onClick={useLastTemplate}>{text.useLastWordTemplate}</button>
        {templatePath && <button type="button" onClick={() => setTemplatePath(null)}>{text.clearWordTemplate}</button>}
      </div>}
      <fieldset className="pandoc-formula-options">
        <legend>{text.formulaExport}</legend>
        <label className={formulaMode === "word" ? "is-selected" : undefined}>
          <input type="radio" name="formula-export-mode" checked={formulaMode === "word"} onChange={() => chooseFormulaMode("word")} />
          <span><strong>{text.wordNativeFormulas}</strong><small>{text.wordNativeFormulasDescription}</small></span>
        </label>
        <label className={formulaMode === "mathTypeBatch" ? "is-selected" : undefined}>
          <input type="radio" name="formula-export-mode" checked={formulaMode === "mathTypeBatch"} onChange={() => chooseFormulaMode("mathTypeBatch")} />
          <span><strong>{text.mathTypeFormulas}</strong><small>{text.mathTypeFormulasDescription}</small></span>
        </label>
      </fieldset>
      {mathTypeSelected && <section className={`pandoc-mathtype-status is-${mathTypeState.kind}`} aria-live="polite">
        <strong>{mathTypeState.kind === "checking" ? text.mathTypeChecking : mathTypeState.kind === "ready" ? text.mathTypeReady : text.mathTypeUnavailable}</strong>
        {mathTypeState.kind === "unavailable" && <p>{mathTypeState.message}</p>}
        <button type="button" onClick={() => void checkMathType()} disabled={mathTypeState.kind === "checking"}>{text.checkMathType}</button>
      </section>}
      {isExporting && exportProgress && <div className="pandoc-export-progress" role="status" aria-live="polite">
        <div className="pandoc-export-progress-label">
          <strong>{describeExportProgress(exportProgress, text)}</strong>
          {exportProgress.total > 0 && <span>{exportProgress.completed} / {exportProgress.total}</span>}
        </div>
        <div className={`pandoc-export-progress-track${exportProgress.total > 0 ? "" : " is-indeterminate"}`}>
          <span style={exportProgress.total > 0 ? { width: `${Math.min(100, exportProgress.completed / exportProgress.total * 100)}%` } : undefined} />
        </div>
        {manualMathTypeStepNeeded && <button
          type="button"
          className="pandoc-manual-mathtype-confirm"
          disabled={isConfirmingManualMathTypeStep}
          onClick={() => void confirmManualMathTypeStep()}
        >{text.docxConfirmManualMathTypeStep}</button>}
      </div>}
      {!document.path && <p className="pandoc-export-note">{text.docxExportRequiresSavedDocument}</p>}
      <div className="pandoc-export-actions">
        <button type="button" className="is-primary" onClick={() => void exportDocx()} disabled={!exportEnabled}>{isExporting ? text.exportingDocx : text.exportDocx}</button>
      </div>
    </section>

    <WordTemplateExperiment document={document} text={text} />

    {notice && <pre className="pandoc-notice" role="status">{notice}</pre>}
  </div>;
}
