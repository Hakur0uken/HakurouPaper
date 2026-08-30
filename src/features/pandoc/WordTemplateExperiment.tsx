import { useCallback, useMemo, useState } from "react";
import { platform, type WordTemplatePocExport, type WordTemplatePocInspection } from "../../platform";
import type { UiText } from "../../i18n";
import type { FeatureDocumentContext } from "../registry";

const requiredTargets = ["HAKUROU_TITLE", "HAKUROU_ABSTRACT", "HAKUROU_BODY"];

type Props = {
  document: FeatureDocumentContext;
  text: UiText;
};

export function WordTemplateExperiment({ document, text }: Props) {
  const [templatePath, setTemplatePath] = useState<string | null>(null);
  const [outputPath, setOutputPath] = useState<string | null>(null);
  const [inspection, setInspection] = useState<WordTemplatePocInspection | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);

  const missingTargets = useMemo(() => {
    if (!inspection) return requiredTargets;
    const available = new Set([
      ...inspection.contentControls.flatMap((control) => control.tag ? [control.tag] : []),
      ...inspection.bookmarks.map((bookmark) => bookmark.name),
    ]);
    return requiredTargets.filter((target) => !available.has(target));
  }, [inspection]);

  const chooseTemplate = useCallback(async () => {
    const path = await platform.dialogs.openFile({
      title: text.chooseDocxTemplate,
      filter: { name: text.wordTemplate, extensions: ["docx"] },
    });
    if (!path) return;
    setTemplatePath(path);
    setInspection(null);
    setNotice(null);
    setLogs([]);
  }, [text.chooseDocxTemplate, text.wordTemplate]);

  const chooseOutput = useCallback(async () => {
    const path = await platform.dialogs.saveFile({
      title: text.chooseDocxDestination,
      defaultPath: `${document.title || text.untitledDocument}-template-experiment.docx`,
      filter: { name: text.wordDocument, extensions: ["docx"] },
    });
    if (path) setOutputPath(path.endsWith(".docx") ? path : `${path}.docx`);
  }, [document.title, text.chooseDocxDestination, text.untitledDocument, text.wordDocument]);

  const analyze = useCallback(async () => {
    if (!templatePath) return;
    setIsAnalyzing(true);
    setNotice(null);
    try {
      const response = await platform.files.inspectWordTemplatePoc(templatePath);
      setInspection(response.inspection);
      setLogs(response.inspection.logs);
      const available = new Set([
        ...response.inspection.contentControls.flatMap((control) => control.tag ? [control.tag] : []),
        ...response.inspection.bookmarks.map((bookmark) => bookmark.name),
      ]);
      const missing = requiredTargets.filter((target) => !available.has(target));
      setNotice(`${text.templateAnalysisSaved(response.reportPath)}\n\n${missing.length ? text.templateTargetsMissing(missing.join(", ")) : text.templateTargetsReady}`);
    } catch (error) {
      setNotice(`${text.templateExperimentFailed}\n${String(error)}`);
    } finally {
      setIsAnalyzing(false);
    }
  }, [templatePath, text]);

  const exportTemplate = useCallback(async () => {
    if (!document.path) {
      setNotice(text.templateExperimentRequiresSavedDocument);
      return;
    }
    if (!templatePath || !outputPath || !inspection || missingTargets.length) return;
    setIsExporting(true);
    setNotice(null);
    try {
      const result: WordTemplatePocExport = await platform.files.exportWordTemplatePoc({
        templatePath,
        outputPath,
        documentPath: document.path,
        content: document.content,
      });
      setLogs(result.logs);
      if (!result.success) {
        const diagnostics = [
          ...(result.anchorIssues ?? []),
          ...(result.gaps ?? []).map((gap) => `${gap.code}: ${gap.detail}`),
        ];
        setNotice(result.unresolvedTargets.length
          ? text.templateTargetsMissing(result.unresolvedTargets.join(", "))
          : `${text.templateExperimentFailed}\n${result.error ?? result.validationErrors.join("\n")}${diagnostics.length ? `\n${diagnostics.join("\n")}` : ""}`);
      } else {
        const preservation = result.preservation
          ? `\n\nchanged: ${result.preservation.changedParts.length}; added: ${result.preservation.addedParts.length}; removed: ${result.preservation.removedParts.length}`
          : "";
        const validation = result.validationReportPath ? `\nvalidation: ${result.validationReportPath}` : "";
        setNotice(`${text.templateExperimentExported(result.outputPath ?? outputPath)}${preservation}${validation}`);
      }
    } catch (error) {
      setNotice(`${text.templateExperimentFailed}\n${String(error)}`);
    } finally {
      setIsExporting(false);
    }
  }, [document.content, document.path, inspection, missingTargets.length, outputPath, templatePath, text]);

  const columns = inspection?.sections.map((section) => section.columns).join(" → ") ?? "—";
  const exportEnabled = Boolean(document.path && templatePath && outputPath && inspection && missingTargets.length === 0 && !isExporting);

  return <section className="pandoc-export-card word-template-experiment" aria-label={text.wordTemplateExperiment}>
    <div className="pandoc-export-card-heading">
      <div><span className="pandoc-docx-icon is-experimental">β</span><h2>{text.wordTemplateExperiment}</h2></div>
      <span>PoC</span>
    </div>
    <p>{text.wordTemplateExperimentDescription}</p>
    <dl className="pandoc-document-summary">
      <div><dt>{text.wordTemplate}</dt><dd title={templatePath ?? undefined}>{templatePath ?? text.noWordTemplate}</dd></div>
      <div><dt>{text.templateOutput}</dt><dd title={outputPath ?? undefined}>{outputPath ?? "—"}</dd></div>
    </dl>
    <div className="pandoc-template-actions">
      <button type="button" onClick={() => void chooseTemplate()}>{text.chooseWordTemplate}</button>
      <button type="button" onClick={() => void chooseOutput()}>{text.chooseTemplateOutput}</button>
      <button type="button" onClick={() => void analyze()} disabled={!templatePath || isAnalyzing}>{isAnalyzing ? text.analyzingWordTemplate : text.analyzeWordTemplate}</button>
    </div>
    {inspection && <div className="word-template-analysis" aria-live="polite">
      <span>Sections: {inspection.sections.length}</span><span>Columns: {columns}</span><span>Styles: {inspection.styles.length}</span><span>Bookmarks: {inspection.bookmarks.length}</span><span>Content Controls: {inspection.contentControls.length}</span><span>Anchors: {inspection.anchors.length}</span>
    </div>}
    {inspection && <p className={missingTargets.length ? "word-template-targets is-missing" : "word-template-targets is-ready"}>
      {missingTargets.length ? text.templateTargetsMissing(missingTargets.join(", ")) : text.templateTargetsReady}
    </p>}
    {!document.path && <p className="pandoc-export-note">{text.templateExperimentRequiresSavedDocument}</p>}
    <div className="pandoc-export-actions">
      <button type="button" className="is-primary" onClick={() => void exportTemplate()} disabled={!exportEnabled}>{isExporting ? text.experimentalExporting : text.experimentalExport}</button>
    </div>
    {notice && <pre className="pandoc-notice" role="status">{notice}</pre>}
    {logs.length > 0 && <details className="word-template-logs"><summary>PoC logs</summary><pre>{logs.join("\n")}</pre></details>}
  </section>;
}
