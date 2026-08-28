import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { DocxExport, DocxExportProgress, FileService, MathTypeStatus, PandocStatus, SharePackage, StoredDocumentFormat } from "../types";

export const tauriFiles: FileService = {
  readMarkdown(path) {
    return invoke<string>("read_markdown", { path });
  },
  writeMarkdown(path, content) {
    return invoke("write_markdown", { path, content });
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
};
