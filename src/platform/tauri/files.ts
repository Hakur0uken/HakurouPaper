import { invoke } from "@tauri-apps/api/core";
import type { FileService, SharePackage, StoredDocumentFormat } from "../types";

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
};
