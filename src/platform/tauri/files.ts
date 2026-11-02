import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DocxExport, DocxExportProgress, FileService, MathTypeStatus, PandocStatus, SharePackage, StoredDocumentFormat, WordTemplatePocExport, WordTemplatePocInspectionResponse } from "../types";

export const tauriFiles: FileService = {
  async onOpenMarkdownRequested(listener) {
    let disposed = false;
    let queue = Promise.resolve();
    const drain = () => {
      queue = queue.then(async () => {
        if (disposed) return;
        const paths = await invoke<string[]>("take_open_markdown_requests");
        // Once taken, finish this batch even if the subscription is cleaned up.
        for (const path of paths) await listener(path);
      }).catch((error) => console.error("Unable to receive Markdown open requests", error));
      return queue;
    };
    // Subscribe before taking startup paths so second launches cannot fall
    // between the initial fetch and event registration.
    const unlisten = await listen("open-markdown-requested", drain);
    // Resolve the subscription only after startup files have finished loading.
    // The app uses this as its first-render barrier, not just listener readiness.
    await drain();
    return () => { disposed = true; unlisten(); };
  },
  readMarkdown(path) {
    return invoke<string>("read_markdown", { path });
  },
  writeMarkdown(path, content) {
    return invoke("write_markdown", { path, content });
  },
  watchMarkdownFile(path) {
    return invoke("watch_markdown_file", { path });
  },
  unwatchMarkdownFile(path) {
    return invoke("unwatch_markdown_file", { path });
  },
  onMarkdownFileChanged(listener) {
    return listen<{ path: string }>("markdown-file-changed", (event) => listener(event.payload.path));
  },
  readDocumentFormat(documentPath, assetFolder) {
    return invoke<StoredDocumentFormat | null>("read_document_format", { documentPath, assetFolder });
  },
  writeDocumentFormat(documentPath, assetFolder, content) {
    return invoke<StoredDocumentFormat>("write_document_format", { documentPath, assetFolder, content });
  },
  exportSharePackage(input) {
    return invoke<SharePackage>("export_share_package", {
      documentPath: input.documentPath,
      content: input.content,
      assetFolder: input.assetFolder,
      formatContent: input.formatContent,
      destinationDir: input.destinationDir,
    });
  },
  inspectPandoc() {
    return invoke<PandocStatus>("inspect_pandoc");
  },
  inspectMathType() {
    return invoke<MathTypeStatus>("inspect_math_type");
  },
  onDocxExportProgress(listener) {
    return listen<DocxExportProgress>("docx-export-progress", (event) => listener(event.payload));
  },
  confirmManualMathTypeStep() {
    return invoke("confirm_manual_mathtype_step");
  },
  exportDocx(input) {
    return invoke<DocxExport>("export_docx", {
      documentPath: input.documentPath,
      content: input.content,
      assetFolder: input.assetFolder,
      assets: input.assets,
      outputPath: input.outputPath,
      referenceDocPath: input.referenceDocPath,
      formulaMode: input.formulaMode,
      formulaPreviews: input.formulaPreviews,
    });
  },
  inspectWordTemplatePoc(templatePath) {
    return invoke<WordTemplatePocInspectionResponse>("inspect_word_template", { templatePath });
  },
  exportWordTemplatePoc(input) {
    return invoke<WordTemplatePocExport>("export_word_template_poc", {
      templatePath: input.templatePath,
      outputPath: input.outputPath,
      documentPath: input.documentPath,
      content: input.content,
    });
  },
};
