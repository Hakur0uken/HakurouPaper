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

export type FileFilter = { name: string; extensions: string[] };
export type MarkdownFileFilter = FileFilter;

export type StoredDocumentFormat = {
  assetFolder: string;
  content: string;
};

export type SharePackage = {
  packagePath: string;
  markdownPath: string;
  assetFolder: string;
};

export type PandocStatus = {
  available: boolean;
  version?: string;
  message?: string;
};

export type MathTypeStatus = {
  available: boolean;
  message?: string;
};

export type FormulaExportMode = "word" | "mathType" | "mathTypeBatch" | "katexPreview";

export type FormulaPreviewAsset = {
  dataBase64: string;
  widthPx: number;
  heightPx: number;
  mathml: string;
  display: boolean;
  /** 原始 LaTeX（含 \tag），用于导出时经 MathType 官方引擎渲染显示层 WMF。 */
  latex: string;
};

export type DocxExport = {
  outputPath: string;
  usedEmfAssets: number;
  usedPreviewFallbackAssets: number;
};

export type DocxExportProgress = {
  phase: "preparing" | "generating" | "mathtypeAwaitingConvertDialog" | "mathtypeConvertDialogReady" | "mathtypeManualConvertNeeded" | "mathtypeBatchConverting" | "mathtypeFormatting" | "mathtypeAwaitingFormatDialog" | "mathtypeFormatDialogReady" | "mathtypeManualFormatNeeded" | "mathtypeFormattingSkipped" | "mathtypeStartingBatch" | "mathtypeRendering" | "saving";
  completed: number;
  total: number;
  batchIndex: number | null;
  batchCount: number | null;
};

export type DocxExportInput = {
  documentPath: string;
  content: string;
  assetFolder: string | null;
  assets: AssetV1[];
  outputPath: string;
  referenceDocPath: string | null;
  formulaMode: FormulaExportMode;
  formulaPreviews?: FormulaPreviewAsset[];
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
  inspectPandoc(): Promise<PandocStatus>;
  inspectMathType(): Promise<MathTypeStatus>;
  onDocxExportProgress(listener: (progress: DocxExportProgress) => void): Promise<() => void>;
  confirmManualMathTypeStep(): Promise<void>;
  exportDocx(input: DocxExportInput): Promise<DocxExport>;
}

export interface DialogService {
  openMarkdown(input: { title: string; filter: MarkdownFileFilter }): Promise<string | null>;
  saveMarkdown(input: { title: string; defaultPath: string; filter: MarkdownFileFilter }): Promise<string | null>;
  openFile(input: { title: string; filter: FileFilter }): Promise<string | null>;
  saveFile(input: { title: string; defaultPath: string; filter: FileFilter }): Promise<string | null>;
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

export interface LinkService {
  openExternal(url: string): Promise<void>;
}

export type PlatformServices = {
  capabilities: PlatformCapabilities;
  files: FileService;
  dialogs: DialogService;
  assets: AssetService;
  window: WindowService;
  links: LinkService;
};
