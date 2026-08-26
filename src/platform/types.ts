import type { AssetV1 } from "../core/schema";

export type PlatformCapabilities = {
  richClipboard: boolean;
  vectorClipboard: boolean;
  externalProcesses: boolean;
  directoryProjects: boolean;
  nativeGit: boolean;
  docxExport: boolean;
  filesystemWatch: boolean;
  multiWindow: boolean;
};

export type MarkdownFileFilter = { name: string; extensions: string[] };

export type StoredDocumentFormat = {
  assetFolder: string;
  content: string;
};

export type SharePackage = {
  packagePath: string;
  markdownPath: string;
  assetFolder: string;
};

export type ClipboardAssetInput = {
  documentPath: string;
  assetFolder: string | null;
  file: File;
};

export type ImportedClipboardAsset = {
  assetFolder: string;
  displayPath: string;
  asset: AssetV1;
};

export interface FileService {
  readMarkdown(path: string): Promise<string>;
  writeMarkdown(path: string, content: string): Promise<void>;
  readDocumentFormat(documentPath: string, assetFolder: string | null): Promise<StoredDocumentFormat | null>;
  writeDocumentFormat(documentPath: string, assetFolder: string | null, content: string): Promise<StoredDocumentFormat>;
  exportSharePackage(input: { documentPath: string; content: string; assetFolder: string | null; formatContent: string; destinationDir: string }): Promise<SharePackage>;
}

export interface DialogService {
  openMarkdown(input: { title: string; filter: MarkdownFileFilter }): Promise<string | null>;
  saveMarkdown(input: { title: string; defaultPath: string; filter: MarkdownFileFilter }): Promise<string | null>;
  selectDirectory(input: { title: string }): Promise<string | null>;
}

export interface AssetService {
  displaySource(source: string, documentPath: string | null): string;
  importClipboardAsset(input: ClipboardAssetInput): Promise<ImportedClipboardAsset>;
}

export interface WindowService {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  requestClose(): Promise<void>;
  startDragging(): Promise<void>;
  onCloseRequested(listener: () => void): Promise<() => void>;
}

export type PlatformServices = {
  capabilities: PlatformCapabilities;
  files: FileService;
  dialogs: DialogService;
  assets: AssetService;
  window: WindowService;
};
