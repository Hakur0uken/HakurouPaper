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

/** Runtime detection of the system Git CLI, separate from platform capability. */
export type GitInstallationStatus = {
  available: boolean;
  version?: string;
  message?: string;
};

export type VersionDocumentScope = {
  documentPath: string;
  assetFolderPath?: string;
};

export type VersionRepositoryInfo = {
  isRepository: boolean;
  repositoryRoot?: string;
  currentBranch?: string;
  hasCommits: boolean;
  documentScope: VersionDocumentScope;
};

/** A user-facing working-tree change, independent from Git's porcelain format. */
export type VersionChangeKind = "added" | "modified" | "deleted" | "renamed" | "untracked";

export type VersionResourceKind = "markdown" | "image" | "metadata" | "other";

export type VersionChange = {
  /** Repository-relative path, supplied by the native provider. */
  path: string;
  /** True only for the Markdown document currently open in HakurouPaper. */
  isDocument: boolean;
  kind: VersionChangeKind;
  resourceKind: VersionResourceKind;
  oldPath?: string;
};

export type DiffLineKind = "context" | "added" | "removed";

export type DiffLine = {
  kind: DiffLineKind;
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
};

export type DiffHunk = {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
};

export type TextFileDiff = {
  kind: "text";
  path: string;
  changeKind: VersionChangeKind;
  oldPath?: string;
  hunks: DiffHunk[];
};

export type BinaryFileDiff = {
  kind: "binary";
  path: string;
  changeKind: VersionChangeKind;
  oldPath?: string;
  /** Reserved for a future image preview or visual-diff capability. */
  previewBefore?: string;
  previewAfter?: string;
};

export type FileDiff = TextFileDiff | BinaryFileDiff;

/** Describes either side of a comparison without tying the viewer to Git HEAD. */
export type RevisionDescriptor = {
  kind: "currentDocument" | "version" | "empty";
  id?: string;
  shortId?: string;
  title?: string;
  timestamp?: string;
  authorName?: string;
  authorEmail?: string;
};

/** A lightweight, read-only image entry captured with a document revision. */
export type RevisionAssetManifest = {
  /** Markdown-facing path, e.g. ./assets/paper-assets/figure.png. */
  path: string;
  mimeType: string;
  /** Git object id when known, so image changes can be compared without reading bytes. */
  contentHash?: string;
  /** A trusted VCS change token for a working-tree asset whose bytes stay lazy. */
  contentIdentity?: string;
};

/** Binary image bytes loaded only after a revision image enters the viewport. */
export type RevisionAssetSnapshot = RevisionAssetManifest & {
  /** Historical resources are never written into the document folder. */
  dataBase64: string;
};

/** Text and metadata required for structural revision comparison. No image bytes. */
export type RevisionTextSnapshot = {
  revision: RevisionDescriptor;
  markdown: string;
  /** hakurou.json content when present; consumers render its effects rather than exposing JSON. */
  metadata?: string;
  assets: RevisionAssetManifest[];
};

export type VersionComparisonSummary = {
  changedFiles: number;
  addedLines: number;
  removedLines: number;
  internalFiles: number;
};

export type VersionComparison = {
  baseRevision: RevisionDescriptor;
  targetRevision: RevisionDescriptor;
  changes: VersionChange[];
  summary: VersionComparisonSummary;
};

export type VersionRecord = {
  id: string;
  shortId: string;
  message: string;
  timestamp: string;
  authorName?: string;
  authorEmail?: string;
  /** All parents are retained so future branching is not modeled as a single chain. */
  parentIds: string[];
};

export type CreateVersionInput = {
  documentPath: string;
  assetFolder: string | null;
  message: string;
};

export type VersionAuthorIdentity = {
  name?: string;
  email?: string;
};

export type RestoreStrategy = "save-current-version-first" | "discard-current-changes";

export type RestoreVersionPreflight = {
  hasUnversionedScopeChanges: boolean;
  targetVersion: VersionRecord;
};

export type RestoreVersionInput = {
  documentPath: string;
  assetFolder: string | null;
  targetCommitId: string;
  strategy: RestoreStrategy;
  safetyVersionMessage?: string;
};

export type RestoreVersionResult = {
  restoredFrom: VersionRecord;
  createdVersion?: VersionRecord;
  alreadyEquivalent: boolean;
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

export type WordTemplatePocSection = {
  index: number;
  breakType: string;
  columns: number;
  pageWidth: number | null;
  pageHeight: number | null;
  margins: { top: number | null; bottom: number | null; left: number | null; right: number | null; gutter: number | null };
};

export type WordTemplatePocInspection = {
  templatePath: string;
  officeImoSectionCount: number;
  sections: WordTemplatePocSection[];
  styles: { id: string; name: string | null; type: string | null }[];
  bookmarks: { name: string; id: string | null }[];
  contentControls: { tag: string | null; title: string | null; kind: string }[];
  anchors: { name: string; kind: string; level: string; occurrences: number; isValid: boolean; issue?: string | null }[];
  headers: { partUri: string; contentType: string }[];
  footers: { partUri: string; contentType: string }[];
  logs: string[];
};

export type WordTemplatePocInspectionResponse = {
  inspection: WordTemplatePocInspection;
  reportPath: string;
};

export type WordTemplatePocExport = {
  success: boolean;
  outputPath: string | null;
  unresolvedTargets: string[];
  preservation: {
    changedParts: { path: string }[];
    addedParts: { path: string }[];
    removedParts: { path: string }[];
  } | null;
  validationErrors: string[];
  validationReportPath?: string | null;
  validationReport?: {
    openXmlValidatorPassed: boolean;
    relationships: { isComplete: boolean; danglingRelationships: string[] };
    duplicateIds: { kind: string; value: string; locations: string[] }[];
    sectionCount: number;
    columns: number[];
    sectPrCount: number;
    unexpectedChangedParts: string[];
    passed: boolean;
  } | null;
  capabilities?: { supported: string[]; preserved: string[]; unsupported: string[]; potentiallyLossy: string[] } | null;
  gaps?: { code: string; feature: string; detail: string; blocking: boolean }[] | null;
  anchorIssues?: string[] | null;
  logs: string[];
  error?: string | null;
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
  inspectWordTemplatePoc(templatePath: string): Promise<WordTemplatePocInspectionResponse>;
  exportWordTemplatePoc(input: { templatePath: string; outputPath: string; documentPath: string; content: string }): Promise<WordTemplatePocExport>;
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

/** A bounded local-Git provider surface; no arbitrary command execution. */
export interface VersionControlService {
  inspectGit(): Promise<GitInstallationStatus>;
  inspectRepository(input: { documentPath: string; assetFolder: string | null }): Promise<VersionRepositoryInfo>;
  initRepository(input: { documentPath: string; assetFolder: string | null }): Promise<VersionRepositoryInfo>;
  getChanges(input: { documentPath: string; assetFolder: string | null }): Promise<VersionChange[]>;
  getComparison(input: { documentPath: string; assetFolder: string | null; versionId?: string | null }): Promise<VersionComparison>;
  getDiff(input: { documentPath: string; assetFolder: string | null; path: string; versionId?: string | null }): Promise<FileDiff>;
  getRevisionTextSnapshot(input: {
    documentPath: string;
    assetFolder: string | null;
    /** A full commit id; omit it with useWorkingCopy for the in-memory current document. */
    revisionId?: string | null;
    useWorkingCopy?: boolean;
    /** Unsaved editor content is used only for the right-hand current-document snapshot. */
    workingContent?: string | null;
  }): Promise<RevisionTextSnapshot>;
  getRevisionAsset(input: {
    documentPath: string;
    assetFolder: string | null;
    revisionId: string;
    /** Markdown-facing resource path from the historical revision manifest. */
    assetPath: string;
  }): Promise<RevisionAssetSnapshot | null>;
  createVersion(input: CreateVersionInput): Promise<VersionRecord>;
  getHistory(input: { documentPath: string; assetFolder: string | null; limit?: number }): Promise<VersionRecord[]>;
  inspectIdentity(input: { documentPath: string; assetFolder: string | null }): Promise<VersionAuthorIdentity>;
  configureIdentity(input: { documentPath: string; assetFolder: string | null; name: string; email: string }): Promise<VersionAuthorIdentity>;
  getRestorePreflight(input: { documentPath: string; assetFolder: string | null; targetCommitId: string }): Promise<RestoreVersionPreflight>;
  restoreVersion(input: RestoreVersionInput): Promise<RestoreVersionResult>;
}

export type PlatformServices = {
  capabilities: PlatformCapabilities;
  files: FileService;
  dialogs: DialogService;
  assets: AssetService;
  window: WindowService;
  links: LinkService;
  versionControl: VersionControlService;
};
