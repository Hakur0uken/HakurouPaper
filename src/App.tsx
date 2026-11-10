import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, defaultValueCtx, rootCtx, parserCtx, serializerCtx } from "@milkdown/core";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener } from "@milkdown/plugin-listener";
import { nord } from "@milkdown/theme-nord";
import { EditorControls } from "./EditorControls";
import { SourceLineNumbers } from "./editor/SourceLineNumbers";
import { MarkdownSourceEditor } from "./editor/MarkdownSourceEditor";
import { createSourceEditing, type LiveEditor } from "./editor/sourceEditing";
import { formatRestoreKey } from "./editor/formatRestore";
import { ExternalMergeDialog, type ExternalMergeInput, type ExternalMergeResult, type MergeSnapshot } from "./collaboration/ExternalMergeDialog";
import { metadataEquivalent } from "./collaboration/merge";
import { useAgentBridge } from "./collaboration/useAgentBridge";
import { featureRegistry, releaseHistoricalAssetsForDocument, releaseRevisionDataForDocument, RenderedRevisionViewer, VersionDiffViewer, type FeatureDocumentContext } from "./features";
import { updateWorkingDirectory } from "./features/remote-sync/workflows";
import { useSoftwareUpdate } from "./features/software-update/useSoftwareUpdate";
import { SoftwareUpdateDialog } from "./features/software-update/SoftwareUpdateDialog";
import { uiText, type UiLanguage, type UiText } from "./i18n";
import { OutlineRailIcon } from "./ui/RailIcons";
import { createImageAssetPlugins } from "./editor/image";
import { formulaPlugins } from "./math";
import { HAKUROU_SCHEMA_VERSION, collectDocumentImageAssets, createDocumentSchema, parseDocumentSidecar, serializeDocumentSidecar, type AssetV1, type DocumentV1 } from "./core/schema";
import { markdownPastePlugin } from "./markdownPaste";
import { handleDocumentLinkClick } from "./documentLinks";
import { platform, type RestoreStrategy, type VersionChange, type VersionRecord } from "./platform";
import { spreadsheetTablePastePlugin } from "./spreadsheetTablePaste";
import { createTableDecorationPlugin, setTableDefaultStyle, tableDefaultStylePluginKey } from "./tableDecorations";
import { createTextLayoutPlugin, setTextDefaultFirstLineIndent, textDefaultLayoutPluginKey } from "./textLayout";
import { createRevisionDecorationPlugin, revisionDecorationPluginKey, scrollToRevisionLocation, setRevisionDecorations } from "./revisionDecorations";
import { RevisionOverviewRuler, useCurrentRevisionLocations, type RevisionLocation } from "./features/version-control";
import { collectDocumentFormatSettings, collectUnresolvedDocumentFormatSettings, documentFormattingChanged } from "./formatPersistence";
import { documentContentFingerprint, emptyDocumentFormatSettings, parseDocumentFormatSettings, removeLegacyFormatMarkers, type DocumentFontSettings, type DocumentFormatDefaults, type DocumentFormatSettings, type DocumentFontWeight } from "./formatTypes";
import { fontFamiliesForInput, fontFamilyStack, fontForPreset, readApplicationAppearance, writeApplicationAppearance, type ApplicationAppearanceSettings, type TableStyle } from "./appearanceSettings";
import hakurouAppIcon from "./assets/hakurou-paper-icon.png";
import "./App.css";
import "./hakurou.css";

const starterDocument = `# 欢迎使用 HakurouPaper

**像编辑普通文档一样自然写作，也让 AI 能安全地参与其中。**

HakurouPaper 是一个为 **人与 AI 协作写作** 而设计的本地文稿工作空间。

不需要学习 Markdown，也不需要了解 Git。

文稿在底层保持为开放、结构清晰的 Markdown，因此你的 AI / Agent 也可以方便地理解、修改和处理它；而版本记录、修改预览和恢复能力，让这些变化始终可见、可检查、可撤销。

## 直接开始写作

标题、正文、图片、表格和公式都可以直接在文稿中编辑。

例如，双击下面的公式即可修改它；也可以直接粘贴 LaTeX 公式：

$$
E = mc^2
$$

表格同样可以直接编辑。将鼠标移入表格即可调整样式和结构，也可以从 Excel 或网页中直接粘贴表格。

| 你要做的事 | HakurouPaper |
| ----- | ------------ |
| 写作与修改 | 像普通文档一样直接编辑  |
| AI 协作 | 开放、结构清晰的文稿   |
| 检查修改  | 排版后的版本比较     |
| 恢复历史  | 本地版本管理       |
| 最终交付  | 可编辑 Word 文档  |

## 每一次修改都看得见

当 AI 开始帮助你重写段落、整理结构或修改整篇文稿时，你不应该重新通读全文，才能知道它究竟改了什么。

创建一个版本后继续写作，HakurouPaper 会直接标记发生变化的位置。

需要检查时，可以查看 **排版后的修改预览**：正文仍然是正文，公式仍然是公式，图片仍然是图片。

如果不满意，也可以恢复之前的版本。

**AI 可以执行修改，而你始终保留检查、确认和恢复的能力。**

这些能力由本地版本系统提供，但你不需要先学习 Git。

## 写完以后，交付为 Word

Word 可以继续作为论文、报告和正式文档的最终交付格式，而不必承担整个写作过程。

日常使用时，可以直接：

* 按 HakurouPaper 当前样式导出可继续编辑的 Word；
* 使用 Word 参考模板控制字体、标题和段落样式；
* 使用 Word 原生公式或 MathType 可编辑公式。

对于期刊、学校或单位提供的复杂 Word 模板，还可以使用 **精确 Word 模板** 能力，在尽量保留原模板分栏、Section、页眉页脚和版式结构的基础上完成交付。

复杂模板更适合让你常用的 **AI / Agent 调用 Hakurou Skill** 完成模板分析、映射、导出和验证。

## 文稿始终属于你

HakurouPaper 不把你的内容锁进私有文档格式。

文稿正文保存在标准 Markdown 中，图片等资源保存在文稿附近，版本历史由标准 Git 管理。

这意味着即使以后换用其他工具，你仍然可以继续打开、编辑和管理自己的文稿。

**人可以自然地写，AI 可以可靠地操作，而最终控制权始终在你手里。**

***

**这就是一篇普通的 HakurouPaper 文稿。**

修改它、删除它，或者新建一篇文稿开始写作。

也可以打开左侧工具栏，看看 **文稿交付** 和 **版本管理**。
`;

type DocumentTab = {
  id: string;
  title: string;
  path: string | null;
  content: string;
  /** Explicit replacement generation; ordinary saves must never change this. */
  documentLoadRevision: number;
  isDirty: boolean;
  /** Monotonic in-memory edit generation for every persistable document mutation. */
  editRevision: number;
  /** Last edit generation known to be fully written to Markdown and hakurou.json. */
  savedRevision: number;
  /** Fingerprint of the Markdown content most recently confirmed on disk. */
  diskFingerprint: string | null;
  diskBase: MergeSnapshot | null;
  /** A newer on-disk revision kept aside while this tab has unsaved edits. */
  externalChange: ExternalDocumentChange | null;
  assetFolder: string | null;
  document: DocumentV1;
  assets: AssetV1[];
  formatSettings: DocumentFormatSettings;
};

type LoadedDocument = {
  content: string;
  assetFolder: string | null;
  document: DocumentV1;
  assets: AssetV1[];
  formatSettings: DocumentFormatSettings;
  sidecarContent?: string;
};

type ExternalDocumentChange = LoadedDocument & {
  fingerprint: string;
  detectedAt: number;
};

type WritingEditorProps = {
  sourceMode: boolean;
  documentId: string;
  markdown: string;
  showLineNumbers: boolean;
  documentLoadRevision: number;
  onContentChange: (documentId: string, markdown: string) => void;
  onEditorReady: (documentId: string, editor: LiveEditor | null) => void;
  onHistoryContext: (documentId: string, context: string) => void;
  documentPath: string | null;
  assetFolder: string | null;
  assets: AssetV1[];
  onAssetImported: (documentId: string, asset: AssetV1, folder: string) => void;
  onAssetResize: (documentId: string, assetId: string, width: number) => void;
  formatSettings: DocumentFormatSettings;
  onFormatChange: (documentId: string, settings: DocumentFormatSettings) => void;
  onSelectionChange: (text: string | null) => void;
  text: UiText;
  tableStyle: TableStyle;
  firstLineIndent: boolean;
  showRevisionChanges: boolean;
  revisionLocations: RevisionLocation[];
  revisionBaselineKey: string;
  onOpenRevisionPreview: (location: RevisionLocation) => void;
};

type DocumentHeading = {
  level: number;
  title: string;
  canCollapse: boolean;
};

type PendingClose = { kind: "tab"; tabId: string } | { kind: "app" } | null;
type ActiveVersionComparison = { initialPath: string | null; versionId: string | null; presentation: "rendered" | "source"; focusLocation?: RevisionLocation | null; externalChange?: boolean };
type RestoreDialog =
  | { kind: "unsaved"; targetCommitId: string; targetTitle: string }
  | { kind: "confirm"; targetCommitId: string; targetTitle: string }
  | { kind: "protect"; targetCommitId: string; targetTitle: string; strategy: RestoreStrategy; safetyMessage: string }
  | null;

type RecentFile = {
  path: string;
  title: string;
};

type AppearanceScope = "document" | "application";
type ViewSubmenu = "document-font" | "document-table" | "document-indent" | "application-font" | "application-table" | "application-indent" | null;
type CustomFontDraft = {
  chineseFamily: string;
  latinFamily: string;
  weight: DocumentFontWeight;
  baseFont: DocumentFontSettings;
};

const recentFilesStorageKey = "hakurou.recent-files";
const uiLanguageStorageKey = "hakurou.ui-language";
const revisionChangesVisibleStorageKey = "hakurou.show-revision-changes";
const lineNumbersVisibleStorageKey = "hakurou.show-line-numbers";

function filenameFromPath(path: string) {
  return path.split(/[\\/]/).pop() ?? "未命名文稿";
}

function readRecentFiles(): RecentFile[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(recentFilesStorageKey) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is RecentFile => typeof item?.path === "string" && typeof item?.title === "string")
      .slice(0, 10);
  } catch {
    return [];
  }
}

function findAssetFolder(markdown: string) {
  return markdown.match(/\]\(\.\/assets\/([^/)]+)\//)?.[1] ?? null;
}

function sameDocumentPath(left: string, right: string) {
  return left.replace(/\//g, "\\").toLocaleLowerCase() === right.replace(/\//g, "\\").toLocaleLowerCase();
}

async function loadDocumentFromDisk(path: string, knownAssetFolder?: string | null): Promise<LoadedDocument> {
  const content = await platform.files.readMarkdown(path);
  const assetFolder = knownAssetFolder ?? findAssetFolder(content);
  const storedFormat = await platform.files.readDocumentFormat(path, assetFolder);
  const parsedSidecar = parseDocumentSidecar(storedFormat?.content);
  return {
    content,
    assetFolder: storedFormat?.assetFolder ?? assetFolder,
    document: parsedSidecar.sidecar.document,
    assets: collectDocumentImageAssets(content, parsedSidecar.sidecar.assets),
    formatSettings: parseDocumentFormatSettings(parsedSidecar.sidecar.format),
    ...(storedFormat?.content ? { sidecarContent: storedFormat.content } : {}),
  };
}

function documentMetadata(document: LoadedDocument) {
  return serializeDocumentSidecar({ schemaVersion: HAKUROU_SCHEMA_VERSION, document: document.document, assets: document.assets, format: document.formatSettings });
}

function diskSnapshot(document: LoadedDocument): MergeSnapshot {
  return { content: document.content, metadata: documentMetadata(document) };
}

function alignLoadedDocument(tab: DocumentTab, loaded: LoadedDocument): LoadedDocument {
  if (loaded.sidecarContent || !tab.diskBase) return loaded;
  const base = parseDocumentSidecar(tab.diskBase.metadata).sidecar;
  return { ...loaded, document: base.document, assets: collectDocumentImageAssets(loaded.content, base.assets) };
}

function unchangedOnDisk(tab: DocumentTab, loaded: LoadedDocument) {
  return loaded.content === tab.diskBase?.content && metadataEquivalent(documentMetadata(loaded), tab.diskBase.metadata);
}

function createDocument(
  markdown = starterDocument,
  path: string | null = null,
  title = "未命名文稿",
  options: { assetFolder?: string | null; document?: DocumentV1; assets?: AssetV1[]; formatSettings?: DocumentFormatSettings; diskBase?: MergeSnapshot } = {},
): DocumentTab {
  return {
    id: crypto.randomUUID(),
    title,
    path,
    content: markdown,
    documentLoadRevision: 0,
    isDirty: false,
    editRevision: 0,
    savedRevision: 0,
    diskFingerprint: path ? documentContentFingerprint(markdown) : null,
    diskBase: options.diskBase ?? null,
    externalChange: null,
    assetFolder: options.assetFolder ?? findAssetFolder(markdown),
    document: options.document ?? createDocumentSchema(),
    assets: options.assets ?? [],
    formatSettings: options.formatSettings ?? emptyDocumentFormatSettings(),
  };
}

function replaceTabFromDisk(tab: DocumentTab, loaded: LoadedDocument): DocumentTab {
  const loadedRevision = Math.max(tab.editRevision, tab.savedRevision) + 1;
  return {
    ...tab,
    content: loaded.content,
    documentLoadRevision: tab.documentLoadRevision + 1,
    isDirty: false,
    editRevision: loadedRevision,
    savedRevision: loadedRevision,
    diskFingerprint: documentContentFingerprint(loaded.content),
    diskBase: diskSnapshot(loaded),
    externalChange: null,
    assetFolder: loaded.assetFolder,
    document: loaded.document,
    assets: loaded.assets,
    formatSettings: loaded.formatSettings,
  };
}

function isPristineWelcomeDocument(document: DocumentTab) {
  return document.path === null && !document.isDirty && document.content === starterDocument;
}

function countWords(markdown: string) {
  const plainText = markdown.replace(/```[\s\S]*?```|`[^`]*`|!?(?:\[[^\]]*\]\([^)]*\))/g, " ");
  const cjkCharacters = plainText.match(/[\u3400-\u9fff]/g)?.length ?? 0;
  const latinWords = plainText.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjkCharacters + latinWords;
}

function WritingEditor({ sourceMode, documentId, markdown, showLineNumbers, documentLoadRevision, onContentChange, onEditorReady, onHistoryContext, documentPath, assetFolder, assets, onAssetImported, onAssetResize, formatSettings, onFormatChange, onSelectionChange, text, tableStyle, firstLineIndent, showRevisionChanges, revisionLocations, revisionBaselineKey, onOpenRevisionPreview }: WritingEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const sourceInputRef = useRef<HTMLTextAreaElement>(null);
  const liveEditorRef = useRef<LiveEditor | null>(null);
  const sourceModeRef = useRef(sourceMode);
  sourceModeRef.current = sourceMode;
  const [editorView, setEditorView] = useState<import("@milkdown/prose/view").EditorView | null>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLElement | null>(null);
  const unresolvedFormatSettingsRef = useRef(emptyDocumentFormatSettings());
  const currentFormatSettingsRef = useRef(formatSettings);
  const currentAssetsRef = useRef(assets);
  const currentDocumentPathRef = useRef(documentPath);
  const currentAssetFolderRef = useRef(assetFolder);
  const contentChangeRef = useRef(onContentChange);
  const editorReadyRef = useRef(onEditorReady);
  const historyContextRef = useRef(onHistoryContext);
  const assetImportedRef = useRef(onAssetImported);
  const assetResizeRef = useRef(onAssetResize);
  const formatChangeRef = useRef(onFormatChange);
  const openRevisionPreviewRef = useRef(onOpenRevisionPreview);
  const revisionLocationsRef = useRef(revisionLocations);
  currentFormatSettingsRef.current = formatSettings;
  currentAssetsRef.current = assets;
  currentDocumentPathRef.current = documentPath;
  currentAssetFolderRef.current = assetFolder;
  contentChangeRef.current = onContentChange;
  editorReadyRef.current = onEditorReady;
  historyContextRef.current = onHistoryContext;
  assetImportedRef.current = onAssetImported;
  assetResizeRef.current = onAssetResize;
  formatChangeRef.current = onFormatChange;
  openRevisionPreviewRef.current = onOpenRevisionPreview;
  revisionLocationsRef.current = revisionLocations;

  useEffect(() => {
    setScrollContainer(mountRef.current?.closest<HTMLElement>(".editor-stage") ?? null);
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const editorHost = document.createElement("div");
    mount.replaceChildren(editorHost);
    let disposed = false;
    const editorControlsBridge = $prose(() => new Plugin({
      view: (proseView) => {
        if (!disposed) setEditorView(proseView);
        unresolvedFormatSettingsRef.current = collectUnresolvedDocumentFormatSettings(proseView.state.doc, currentFormatSettingsRef.current);
        queueMicrotask(() => {
          if (disposed) return;
          const migration = removeLegacyFormatMarkers(proseView.state);
          if (migration) proseView.dispatch(migration);
        });
        return {
          update: (nextView, previousState) => {
            if (!disposed && documentFormattingChanged(previousState, nextView.state)) {
              formatChangeRef.current(documentId, collectDocumentFormatSettings(nextView.state, unresolvedFormatSettingsRef.current, currentFormatSettingsRef.current.defaults));
            }
          },
          destroy: () => {
            if (!disposed) setEditorView(null);
          },
        };
      },
    }));
    const editor = Editor.make();
    let contextDocument: import("@milkdown/prose/model").Node | undefined;
    const sourceEditing = $prose((ctx) => createSourceEditing(
      markdown,
      (markdown) => ctx.get(parserCtx)(markdown),
      (doc) => ctx.get(serializerCtx)(doc),
      (markdown) => contentChangeRef.current(documentId, markdown),
      (editor) => {
        if (disposed) return;
        liveEditorRef.current = editor;
        editorReadyRef.current(documentId, editor && { ...editor, focus: () => {
          if (sourceModeRef.current) sourceInputRef.current?.focus({ preventScroll: true });
          else editor.focus();
        } });
      },
      (context) => {
        const sidecar = parseDocumentSidecar(context).sidecar;
        currentFormatSettingsRef.current = parseDocumentFormatSettings(sidecar.format);
        currentAssetsRef.current = sidecar.assets;
        if (contextDocument) unresolvedFormatSettingsRef.current = collectUnresolvedDocumentFormatSettings(contextDocument, currentFormatSettingsRef.current);
        historyContextRef.current(documentId, context);
      },
      (transaction, context) => {
        const settings = parseDocumentFormatSettings(parseDocumentSidecar(context).sidecar.format);
        const defaults = readApplicationAppearance();
        contextDocument = transaction.doc;
        return transaction.setMeta(formatRestoreKey, { settings,
          tableStyle: settings.defaults.tableStyle ?? defaults.tableStyle,
          firstLineIndent: settings.defaults.firstLineIndent ?? defaults.firstLineIndent,
        });
      },
    ));
    editor
      .config(nord)
      .config((ctx) => {
        ctx.set(rootCtx, editorHost);
        ctx.set(defaultValueCtx, markdown);
      })
      .use(commonmark)
      .use(gfm)
      .use(spreadsheetTablePastePlugin)
      .use(markdownPastePlugin)
      .use(history)
      .use(listener)
      .use(formulaPlugins)
      .use(createImageAssetPlugins(
        {
          documentPath,
          assetFolder,
          getDocumentPath: () => currentDocumentPathRef.current,
          getAssetFolder: () => currentAssetFolderRef.current,
          assets: platform.assets,
          findAsset: (displayPath) => currentAssetsRef.current.find((asset) => asset.preview?.path === displayPath || asset.source.path === displayPath),
          onAssetImported: (asset, folder) => assetImportedRef.current(documentId, asset, folder),
          onAssetResize: (assetId, width) => assetResizeRef.current(documentId, assetId, width),
          onImportError: (error) => window.alert(String(error)),
        },
      ))
      .use(createTableDecorationPlugin(currentFormatSettingsRef.current, tableStyle))
      .use(createTextLayoutPlugin(currentFormatSettingsRef.current, firstLineIndent))
      .use(createRevisionDecorationPlugin((locationId) => {
        const location = revisionLocationsRef.current.find((candidate) => candidate.id === locationId);
        if (location) openRevisionPreviewRef.current(location);
      }))
      .use(sourceEditing)
      .use(editorControlsBridge);
    void editor.create().catch(console.error);
    return () => {
      editorReadyRef.current(documentId, null);
      liveEditorRef.current = null;
      disposed = true;
      setEditorView(null);
      void editor.destroy().catch(console.error);
      if (mount.contains(editorHost)) mount.replaceChildren();
    };
  // A save may update path and saved state, but must preserve the live
  // ProseMirror instance, selection, scroll position, and undo history.
  // The latest Markdown is read when mounting a tab or explicitly reloading;
  // ordinary input and saves must never recreate the editor.
  }, [documentId, documentLoadRevision]);

  useEffect(() => {
    if (!editorView) return;
    editorView.dispatch(editorView.state.tr.setMeta(tableDefaultStylePluginKey, setTableDefaultStyle(tableStyle)));
  }, [editorView, tableStyle]);

  useEffect(() => {
    if (!editorView) return;
    editorView.dispatch(editorView.state.tr.setMeta(textDefaultLayoutPluginKey, setTextDefaultFirstLineIndent(firstLineIndent)));
  }, [editorView, firstLineIndent]);

  useEffect(() => {
    if (!editorView) return;
    editorView.dispatch(editorView.state.tr
      .setMeta("addToHistory", false)
      .setMeta(revisionDecorationPluginKey, setRevisionDecorations(showRevisionChanges, revisionLocations, revisionBaselineKey)));
  }, [editorView, revisionBaselineKey, revisionLocations, showRevisionChanges]);

  useEffect(() => {
    if (!editorView) return;
    if (sourceMode) sourceInputRef.current?.focus({ preventScroll: true });
    else editorView.focus();
    onSelectionChange(null);
  }, [sourceMode, editorView, onSelectionChange]);

  const navigateRevisionLocation = useCallback((location: RevisionLocation) => {
    if (location.kind === "removed") onOpenRevisionPreview(location);
    else if (editorView) scrollToRevisionLocation(editorView, location.id);
  }, [editorView, onOpenRevisionPreview]);

  return <div className={`writing-editor-root${showRevisionChanges ? " is-showing-revision-changes" : ""}`}>
    <div ref={mountRef} hidden={sourceMode} data-milkdown-root="true" onClickCapture={handleDocumentLinkClick} onAuxClickCapture={handleDocumentLinkClick} />
    <MarkdownSourceEditor markdown={markdown} hidden={!sourceMode} ready={Boolean(editorView)} showLineNumbers={showLineNumbers} inputRef={sourceInputRef} text={text}
      onChange={(markdown) => liveEditorRef.current?.replace(markdown)}
      onHistory={(redo) => { if (redo) liveEditorRef.current?.redo(); else liveEditorRef.current?.undo(); }}
      onSelectionChange={onSelectionChange} />
    {!sourceMode && showLineNumbers && <SourceLineNumbers view={editorView} markdown={markdown} />}
    {!sourceMode && showRevisionChanges && <RevisionOverviewRuler locations={revisionLocations} onNavigate={navigateRevisionLocation} scrollContainer={scrollContainer} className="editor-revision-overview" />}
    {!sourceMode && <EditorControls view={editorView} onSelectionChange={onSelectionChange} text={text} />}
  </div>;
}

function App() {
  const [startupReady, setStartupReady] = useState(false);
  const [tabs, setTabsState] = useState<DocumentTab[]>(() => [createDocument()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]!.id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [language, setLanguage] = useState<UiLanguage>(() => window.localStorage.getItem(uiLanguageStorageKey) === "en" ? "en" : "zh");
  const [applicationAppearance, setApplicationAppearance] = useState<ApplicationAppearanceSettings>(readApplicationAppearance);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [collapsedHeadings, setCollapsedHeadings] = useState<Record<string, number[]>>({});
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(readRecentFiles);
  const [recentFilesMenuOpen, setRecentFilesMenuOpen] = useState(false);
  const [viewSubmenu, setViewSubmenu] = useState<ViewSubmenu>(null);
  const [customFontTarget, setCustomFontTarget] = useState<AppearanceScope | null>(null);
  const [customFontDraft, setCustomFontDraft] = useState<CustomFontDraft>({ chineseFamily: "", latinFamily: "", weight: 400, baseFont: fontForPreset("standard") });
  const [activeFeatureId, setActiveFeatureId] = useState<string | null>(null);
  const [headRevisionEpoch, setHeadRevisionEpoch] = useState(0);
  const [workingTreeEpoch, setWorkingTreeEpoch] = useState(0);
  const [repositoryBusy, setRepositoryBusy] = useState(false);
  const repositoryOperationRef = useRef(false);
  const [activeVersionComparison, setActiveVersionComparison] = useState<ActiveVersionComparison | null>(null);
  const [showRevisionChanges, setShowRevisionChanges] = useState(() => window.localStorage.getItem(revisionChangesVisibleStorageKey) === "true");
  const [showLineNumbers, setShowLineNumbers] = useState(() => window.localStorage.getItem(lineNumbersVisibleStorageKey) === "true");
  const [sourceMode, setSourceMode] = useState(false);
  const [restoreDialog, setRestoreDialog] = useState<RestoreDialog>(null);
  const [isRestoringVersion, setIsRestoringVersion] = useState(false);
  const [dismissedExternalChangeKey, setDismissedExternalChangeKey] = useState<string | null>(null);
  const [externalMerge, setExternalMerge] = useState<ExternalMergeInput | null>(null);
  const menuListRef = useRef<HTMLElement>(null);
  const tabsRef = useRef(tabs);
  const setTabs = useCallback((change: DocumentTab[] | ((tabs: DocumentTab[]) => DocumentTab[])) => {
    const next = typeof change === "function" ? change(tabsRef.current) : change;
    tabsRef.current = next;
    setTabsState(next);
  }, []);
  const liveEditorsRef = useRef(new Map<string, LiveEditor>());
  const registerEditor = useCallback((id: string, editor: LiveEditor | null) => {
    if (editor) liveEditorsRef.current.set(id, editor);
    else liveEditorsRef.current.delete(id);
  }, []);
  const applyHistoryContext = useCallback((id: string, context: string) => {
    const parsed = parseDocumentSidecar(context).sidecar;
    setTabs((tabs) => tabs.map((tab) => tab.id !== id ? tab : {
      ...tab, document: parsed.document, assets: collectDocumentImageAssets(tab.content, parsed.assets),
      formatSettings: parseDocumentFormatSettings(parsed.format), isDirty: true, editRevision: tab.editRevision + 1,
    }));
  }, [setTabs]);
  const externalChangeTimersRef = useRef(new Map<string, number>());
  const ownMarkdownWritesRef = useRef(new Map<string, { fingerprint: string; metadata: string; expiresAt: number }>());
  const savingDocumentsRef = useRef(new Set<string>());
  const watchedMarkdownPathsRef = useRef(new Set<string>());
  const markdownWatchQueueRef = useRef(Promise.resolve());
  const recentFilesMenuTimerRef = useRef<number | null>(null);
  const viewSubmenuTimerRef = useRef<number | null>(null);
  const editorStageRef = useRef<HTMLElement>(null);

  const activeDocument = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!,
    [activeTabId, tabs],
  );
  const text = uiText[language];
  const softwareUpdate = useSoftwareUpdate(startupReady, () =>
    repositoryOperationRef.current ? "busy" :
      tabsRef.current.some((tab) => tab.isDirty || tab.externalChange) ? "unsaved" : null);
  const updateInstallationBlock = repositoryBusy ? "busy" :
    tabs.some((tab) => tab.isDirty || tab.externalChange) ? "unsaved" : null;
  const runRepositoryOperation = useCallback(async (operation: () => Promise<void>) => {
    if (repositoryOperationRef.current) throw new Error(text.remoteSync.operationBusy);
    repositoryOperationRef.current = true;
    setRepositoryBusy(true);
    try { await operation(); }
    finally { repositoryOperationRef.current = false; setRepositoryBusy(false); }
  }, [text.remoteSync.operationBusy]);
  const activeExternalChangeKey = activeDocument.externalChange ? `${activeDocument.id}\u0000${activeDocument.externalChange.fingerprint}` : null;
  const externalChangeDialogVisible = Boolean(activeExternalChangeKey && activeExternalChangeKey !== dismissedExternalChangeKey);
  const externalChangeComparison = useMemo(() => {
    const external = activeDocument.externalChange;
    if (!external) return undefined;
    const localRevision = { kind: "currentDocument" as const, title: text.externalChangeLocalVersion };
    const externalRevision = { kind: "currentDocument" as const, title: text.externalChangeDiskVersion };
    const localMetadata = serializeDocumentSidecar({
      schemaVersion: HAKUROU_SCHEMA_VERSION,
      document: activeDocument.document,
      assets: activeDocument.assets,
      format: activeDocument.formatSettings,
    });
    const localAssets = activeDocument.assets.map((asset) => ({
      path: asset.preview?.path ?? asset.source.path,
      mimeType: asset.preview?.mimeType ?? asset.source.mimeType ?? "image/*",
    }));
    const externalAssets = external.assets.map((asset) => ({
      path: asset.preview?.path ?? asset.source.path,
      mimeType: asset.preview?.mimeType ?? asset.source.mimeType ?? "image/*",
    }));
    return {
      comparison: {
        baseRevision: localRevision,
        targetRevision: externalRevision,
        changes: [],
        summary: { changedFiles: 1, addedLines: 0, removedLines: 0, internalFiles: 0 },
      },
      before: { revision: localRevision, markdown: activeDocument.content, metadata: localMetadata, assets: localAssets },
      after: { revision: externalRevision, markdown: external.content, ...(external.sidecarContent ? { metadata: external.sidecarContent } : {}), assets: externalAssets },
    };
  }, [activeDocument, text.externalChangeDiskVersion, text.externalChangeLocalVersion]);
  const activeFeature = featureRegistry.getSidebarContribution(activeFeatureId);
  const ActiveFeatureWorkspace = activeFeature?.Workspace;
  const featureDocument = useMemo<FeatureDocumentContext>(() => ({
    title: activeDocument.title,
    path: activeDocument.path,
    content: activeDocument.content,
    assetFolder: activeDocument.assetFolder,
    assets: activeDocument.assets,
    sidecarContent: serializeDocumentSidecar({
      schemaVersion: HAKUROU_SCHEMA_VERSION,
      document: activeDocument.document,
      assets: activeDocument.assets,
      format: activeDocument.formatSettings,
    }),
    isDirty: activeDocument.isDirty,
    headRevisionEpoch,
    workingTreeEpoch,
  }), [activeDocument.assetFolder, activeDocument.assets, activeDocument.content, activeDocument.document, activeDocument.formatSettings, activeDocument.isDirty, activeDocument.path, activeDocument.title, headRevisionEpoch, workingTreeEpoch]);
  const revisionLocationState = useCurrentRevisionLocations(featureDocument, showRevisionChanges);
  const revisionLocations = revisionLocationState.locations;
  const effectiveDocumentDefaults = useMemo(() => ({
    font: activeDocument.formatSettings.defaults.font ?? applicationAppearance.font,
    tableStyle: activeDocument.formatSettings.defaults.tableStyle ?? applicationAppearance.tableStyle,
    firstLineIndent: activeDocument.formatSettings.defaults.firstLineIndent ?? applicationAppearance.firstLineIndent,
  }), [activeDocument.formatSettings.defaults.firstLineIndent, activeDocument.formatSettings.defaults.font, activeDocument.formatSettings.defaults.tableStyle, applicationAppearance.firstLineIndent, applicationAppearance.font, applicationAppearance.tableStyle]);
  const documentFontStyle = useMemo(() => ({
    "--hakurou-document-font-family": fontFamilyStack(effectiveDocumentDefaults.font),
    "--hakurou-document-font-weight": String(effectiveDocumentDefaults.font.weight),
  } as React.CSSProperties), [effectiveDocumentDefaults.font]);

  useEffect(() => {
    window.localStorage.setItem(uiLanguageStorageKey, language);
  }, [language]);

  useEffect(() => {
    window.localStorage.setItem(revisionChangesVisibleStorageKey, String(showRevisionChanges));
  }, [showRevisionChanges]);

  useEffect(() => {
    window.localStorage.setItem(lineNumbersVisibleStorageKey, String(showLineNumbers));
  }, [showLineNumbers]);

  useEffect(() => {
    writeApplicationAppearance(applicationAppearance);
  }, [applicationAppearance]);

  const documentHeadings = useMemo<DocumentHeading[]>(() => {
    const matches = [...activeDocument.content.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)];
    return matches.map((match, index) => {
      const level = match[1]!.length;
      const boundary = matches.slice(index + 1).find((candidate) => candidate[1]!.length <= level);
      const boundaryIndex = boundary ? matches.indexOf(boundary, index + 1) : matches.length;
      return {
        level,
        title: match[2]!.trim(),
        canCollapse: matches.slice(index + 1, boundaryIndex).some((candidate) => candidate[1]!.length > level),
      };
    });
  }, [activeDocument.content]);

  const updateDocument = useCallback((documentId: string, markdown: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== documentId || tab.content === markdown) return tab;
      return { ...tab, content: markdown, assetFolder: tab.assetFolder ?? findAssetFolder(markdown), isDirty: true, editRevision: tab.editRevision + 1 };
    }));
  }, []);

  const updateDocumentAsset = useCallback((documentId: string, asset: AssetV1, assetFolder: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== documentId) return tab;
      const assets = [...tab.assets.filter((current) => current.assetId !== asset.assetId), asset];
      return { ...tab, assets, assetFolder, isDirty: true, editRevision: tab.editRevision + 1 };
    }));
    // Asset import writes into the document scope immediately, so refresh the
    // Git-status sidebar without disturbing the immutable HEAD baseline.
    setWorkingTreeEpoch((epoch) => epoch + 1);
  }, []);

  const resizeDocumentAsset = useCallback((documentId: string, assetId: string, width: number) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== documentId) return tab;
      const currentAsset = tab.assets.find((asset) => asset.assetId === assetId);
      if (!currentAsset || currentAsset.display?.width === width) return tab;
      const assets = tab.assets.map((asset) => (
        asset.assetId === assetId ? { ...asset, display: { width } } : asset
      ));
      return { ...tab, assets, isDirty: true, editRevision: tab.editRevision + 1 };
    }));
  }, []);

  const toggleDocumentSidebar = useCallback(() => {
    setActiveFeatureId(null);
    setSidebarOpen((visible) => activeFeatureId ? true : !visible);
  }, [activeFeatureId]);

  const updateDocumentFormatSettings = useCallback((documentId: string, settings: DocumentFormatSettings) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== documentId) return tab;
      const nextSettings = { ...settings, ...(tab.formatSettings.documentFingerprint ? { documentFingerprint: tab.formatSettings.documentFingerprint } : {}) };
      const { documentFingerprint: _currentFingerprint, ...currentComparable } = tab.formatSettings;
      const { documentFingerprint: _nextFingerprint, ...nextComparable } = nextSettings;
      if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable)) return tab;
      return { ...tab, formatSettings: nextSettings, isDirty: true, editRevision: tab.editRevision + 1 };
    }));
  }, []);

  const updateActiveDocumentDefaults = useCallback((updates: Partial<DocumentFormatDefaults>) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== activeDocument.id) return tab;
      const defaults = { ...tab.formatSettings.defaults, ...updates };
      if (JSON.stringify(defaults) === JSON.stringify(tab.formatSettings.defaults)) return tab;
      return { ...tab, formatSettings: { ...tab.formatSettings, defaults }, isDirty: true, editRevision: tab.editRevision + 1 };
    }));
  }, [activeDocument.id]);

  const applyFont = useCallback((scope: AppearanceScope, font: DocumentFontSettings) => {
    if (scope === "document") updateActiveDocumentDefaults({ font });
    else setApplicationAppearance((current) => ({ ...current, font }));
    setViewSubmenu(null);
    setOpenMenu(null);
  }, [updateActiveDocumentDefaults]);

  const applyTableStyle = useCallback((scope: AppearanceScope, tableStyle: TableStyle) => {
    if (scope === "document") updateActiveDocumentDefaults({ tableStyle });
    else setApplicationAppearance((current) => ({ ...current, tableStyle }));
    setViewSubmenu(null);
    setOpenMenu(null);
  }, [updateActiveDocumentDefaults]);

  const applyFirstLineIndent = useCallback((scope: AppearanceScope, firstLineIndent: boolean) => {
    if (scope === "document") updateActiveDocumentDefaults({ firstLineIndent });
    else setApplicationAppearance((current) => ({ ...current, firstLineIndent }));
    setViewSubmenu(null);
    setOpenMenu(null);
  }, [updateActiveDocumentDefaults]);

  const openCustomFontDialog = useCallback((scope: AppearanceScope) => {
    const currentFont = scope === "document" ? effectiveDocumentDefaults.font : applicationAppearance.font;
    setCustomFontDraft({
      chineseFamily: "",
      latinFamily: "",
      weight: currentFont.weight,
      baseFont: currentFont,
    });
    setCustomFontTarget(scope);
    setViewSubmenu(null);
    setOpenMenu(null);
  }, [applicationAppearance.font, effectiveDocumentDefaults.font]);

  const applyCustomFont = useCallback(() => {
    if (!customFontTarget) return;
    const chineseFamily = customFontDraft.chineseFamily.trim();
    const latinFamily = customFontDraft.latinFamily.trim();
    const baseFamilies = fontFamiliesForInput(customFontDraft.baseFont);
    applyFont(customFontTarget, chineseFamily || latinFamily
      ? { preset: "custom", weight: customFontDraft.weight, chineseFamily: chineseFamily || baseFamilies.chinese, latinFamily: latinFamily || baseFamilies.latin }
      : { ...customFontDraft.baseFont, weight: customFontDraft.weight });
    setCustomFontTarget(null);
  }, [applyFont, customFontDraft, customFontTarget]);

  const updateSelectedText = useCallback((text: string | null) => setSelectedText(text), []);

  const activateDocument = useCallback((documentId: string) => {
    setActiveVersionComparison(null);
    setActiveTabId(documentId);
  }, []);

  const openVersionDiff = useCallback((change: VersionChange) => setActiveVersionComparison({ initialPath: change.path, versionId: null, presentation: "rendered" }), []);
  const openVersionHistoryComparison = useCallback((version: VersionRecord) => setActiveVersionComparison({ initialPath: null, versionId: version.id, presentation: "rendered" }), []);
  const openRevisionPreviewAtLocation = useCallback((location: RevisionLocation) => setActiveVersionComparison({ initialPath: null, versionId: null, presentation: "rendered", focusLocation: location }), []);
  const closeVersionDiff = useCallback(() => {
    setActiveVersionComparison((current) => current?.presentation === "source" ? { ...current, presentation: "rendered" } : null);
  }, []);
  const openAdvancedVersionComparison = useCallback(() => {
    if (activeDocument.isDirty && !window.confirm(text.versionAdvancedUnsavedNotice)) return;
    setActiveVersionComparison((current) => current ? { ...current, presentation: "source" } : current);
  }, [activeDocument.isDirty, text.versionAdvancedUnsavedNotice]);

  const createNewDocument = useCallback(() => {
    const document = createDocument();
    setTabs((currentTabs) => [...currentTabs, document]);
    setActiveVersionComparison(null);
    setActiveTabId(document.id);
  }, []);

  const rememberRecentFile = useCallback((path: string) => {
    const file = { path, title: filenameFromPath(path) };
    setRecentFiles((currentFiles) => {
      const nextFiles = [file, ...currentFiles.filter((item) => item.path !== path)].slice(0, 10);
      window.localStorage.setItem(recentFilesStorageKey, JSON.stringify(nextFiles));
      return nextFiles;
    });
  }, []);

  const forgetRecentFile = useCallback((path: string) => {
    setRecentFiles((currentFiles) => {
      const nextFiles = currentFiles.filter((item) => !sameDocumentPath(item.path, path));
      window.localStorage.setItem(recentFilesStorageKey, JSON.stringify(nextFiles));
      return nextFiles;
    });
  }, []);

  const addOpenedDocument = useCallback((loaded: LoadedDocument, path: string) => {
    const currentTabs = tabsRef.current;
    const existingDocument = currentTabs.find((tab) => tab.path && sameDocumentPath(tab.path, path));
    if (existingDocument) {
      const fingerprint = documentContentFingerprint(loaded.content);
      setTabs((currentTabs) => currentTabs.map((tab) => {
        if (tab.id !== existingDocument.id) return tab;
        const aligned = alignLoadedDocument(tab, loaded);
        if (unchangedOnDisk(tab, aligned)) return tab.externalChange ? { ...tab, externalChange: null } : tab;
        if (!tab.isDirty) return replaceTabFromDisk(tab, aligned);
        if (aligned.content === tab.content && metadataEquivalent(documentMetadata(aligned), documentMetadata(tab))) return { ...tab, diskFingerprint: fingerprint, diskBase: diskSnapshot(aligned), externalChange: null };
        return { ...tab, externalChange: { ...aligned, fingerprint: documentContentFingerprint(aligned.content + documentMetadata(aligned)), detectedAt: Date.now() } };
      }));
      activateDocument(existingDocument.id);
      return;
    }
    const filename = filenameFromPath(path);
    const document = createDocument(loaded.content, path, filename.replace(/\.(md|markdown|mdx)$/i, ""), {
      formatSettings: loaded.formatSettings,
      assetFolder: loaded.assetFolder,
      document: loaded.document,
      assets: loaded.assets,
      diskBase: diskSnapshot(loaded),
    });
    if (currentTabs.length === 1 && isPristineWelcomeDocument(currentTabs[0]!)) {
      // Do not reuse the welcome tab's identity here. The editor deliberately
      // preserves its live ProseMirror state across routine prop changes, so a
      // reused ID would leave the welcome document rendered after opening a
      // real file.
      setTabs([document]);
      setActiveTabId(document.id);
      return;
    }
    setTabs((currentTabs) => [...currentTabs, document]);
    setActiveTabId(document.id);
  }, [activateDocument]);

  const openDocumentPath = useCallback(async (path: string) => {
    try {
      addOpenedDocument(await loadDocumentFromDisk(path), path);
      rememberRecentFile(path);
    } catch (error) {
      forgetRecentFile(path);
      window.alert(`无法打开文稿：${String(error)}`);
    }
  }, [addOpenedDocument, forgetRecentFile, rememberRecentFile]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void platform.files.onOpenMarkdownRequested(openDocumentPath).then((cleanup) => {
      if (disposed) cleanup();
      else {
        unlisten = cleanup;
        setStartupReady(true);
      }
    }).catch((error) => {
      console.error("Unable to subscribe to Markdown open requests", error);
      if (!disposed) setStartupReady(true);
    });
    return () => { disposed = true; unlisten?.(); };
  }, [openDocumentPath]);

  const handleOpen = useCallback(async () => {
    const selectedPath = await platform.dialogs.openMarkdown({
      title: text.openMarkdownDocument,
      filter: { name: text.markdown, extensions: ["md", "markdown", "mdx"] },
    });
    if (!selectedPath) return;
    await openDocumentPath(selectedPath);
  }, [openDocumentPath, text.markdown, text.openMarkdownDocument]);

  const processExternalDocumentChange = useCallback(async (documentId: string, path: string) => {
    let loaded: LoadedDocument;
    try {
      loaded = await loadDocumentFromDisk(path, tabsRef.current.find((tab) => tab.id === documentId)?.assetFolder);
      // A sidecar directory may have appeared since this file was opened.
      await platform.files.watchMarkdownFile(path, loaded.assetFolder);
    } catch {
      // An editor may briefly replace a file through its own temporary path.
      // A later native event will retry once the replacement is complete.
      return false;
    }
    const fingerprint = documentContentFingerprint(loaded.content);
    const ownWrite = ownMarkdownWritesRef.current.get(path);
    if (ownWrite && ownWrite.expiresAt < Date.now()) ownMarkdownWritesRef.current.delete(path);
    if (ownWrite?.fingerprint === fingerprint && ownWrite.expiresAt >= Date.now() && metadataEquivalent(documentMetadata(loaded), ownWrite.metadata)) {
      setTabs((currentTabs) => currentTabs.map((tab) => (
        tab.id === documentId && tab.path && sameDocumentPath(tab.path, path) && tab.diskFingerprint !== fingerprint
          ? { ...tab, diskFingerprint: fingerprint, diskBase: diskSnapshot(loaded), externalChange: null }
          : tab
      )));
      return true;
    }
    let changed = false;
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== documentId || !tab.path || !sameDocumentPath(tab.path, path)) return tab;
      const aligned = alignLoadedDocument(tab, loaded);
      if (unchangedOnDisk(tab, aligned)) return tab.externalChange ? { ...tab, externalChange: null } : tab;
      if (aligned.content === tab.content && metadataEquivalent(documentMetadata(aligned), documentMetadata(tab))) {
        changed = true;
        return { ...tab, diskFingerprint: fingerprint, diskBase: diskSnapshot(aligned), externalChange: null };
      }
      changed = true;
      if (!tab.isDirty) return replaceTabFromDisk(tab, aligned);
      const changeFingerprint = documentContentFingerprint(aligned.content + documentMetadata(aligned));
      if (tab.externalChange?.fingerprint === changeFingerprint) return tab;
      return { ...tab, externalChange: { ...aligned, fingerprint: changeFingerprint, detectedAt: Date.now() } };
    }));
    if (changed) setWorkingTreeEpoch((epoch) => epoch + 1);
    return true;
  }, []);

  const reloadDocumentFromDisk = useCallback(async (documentId: string, path: string) => {
    const loaded = await loadDocumentFromDisk(path, tabsRef.current.find((tab) => tab.id === documentId)?.assetFolder);
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === documentId && tab.path && sameDocumentPath(tab.path, path)
        ? replaceTabFromDisk(tab, alignLoadedDocument(tab, loaded))
        : tab
    )));
    setWorkingTreeEpoch((epoch) => epoch + 1);
  }, []);

  const handleSave = useCallback(async (requestedId = activeDocument.id) => {
    const openedDocument = tabsRef.current.find((tab) => tab.id === requestedId);
    if (!openedDocument || savingDocumentsRef.current.has(requestedId)) return false;
    savingDocumentsRef.current.add(requestedId);
    return (async () => {
    const documentId = openedDocument.id;
    let targetPath = openedDocument.path;
    if (!targetPath) {
      const chosenPath = await platform.dialogs.saveMarkdown({
        title: text.saveMarkdownDocument,
        defaultPath: `${openedDocument.title || text.untitledDocument}.md`,
        filter: { name: text.markdown, extensions: ["md"] },
      });
      if (!chosenPath) return false;
      targetPath = chosenPath.endsWith(".md") ? chosenPath : `${chosenPath}.md`;
    }
    try {
      // Capture one coherent bundle before I/O. Later editor mutations advance
      // editRevision and are intentionally left dirty when this save completes.
      const savingDocument = tabsRef.current.find((tab) => tab.id === documentId) ?? openedDocument;
      const savingRevision = savingDocument.editRevision;
      if (savingDocument.externalChange) {
        setDismissedExternalChangeKey(null);
        return false;
      }
      if (savingDocument.path && sameDocumentPath(savingDocument.path, targetPath)) {
        try {
          const disk = alignLoadedDocument(savingDocument, await loadDocumentFromDisk(targetPath, savingDocument.assetFolder));
          if (!unchangedOnDisk(savingDocument, disk)) {
            await processExternalDocumentChange(documentId, targetPath);
            setDismissedExternalChangeKey(null);
            return false;
          }
        } catch (error) {
          window.alert(String(error));
          return false;
        }
      }
      const formatSettings = {
        ...savingDocument.formatSettings,
        documentFingerprint: documentContentFingerprint(savingDocument.content),
      };
      const savingFingerprint = documentContentFingerprint(savingDocument.content);
      const sidecarContent = serializeDocumentSidecar({
        schemaVersion: HAKUROU_SCHEMA_VERSION,
        document: savingDocument.document,
        assets: savingDocument.assets,
        format: formatSettings,
      });
      ownMarkdownWritesRef.current.set(targetPath, { fingerprint: savingFingerprint, metadata: sidecarContent, expiresAt: Date.now() + 2_500 });
      await platform.files.writeMarkdown(targetPath, savingDocument.content, savingDocument.path && sameDocumentPath(savingDocument.path, targetPath) ? savingDocument.diskBase?.content : undefined);
      const storedFormat = await platform.files.writeDocumentFormat(targetPath, savingDocument.assetFolder, sidecarContent);
      await platform.files.watchMarkdownFile(targetPath, storedFormat.assetFolder);
      const title = (targetPath.split(/[\\/]/).pop() ?? "未命名文稿").replace(/\.md$/i, "");
      const snapshotWasCurrent = tabsRef.current.find((tab) => tab.id === documentId)?.editRevision === savingRevision;
      setTabs((currentTabs) => currentTabs.map((tab) => {
        if (tab.id !== documentId) return tab;
        if (tab.editRevision !== savingRevision) {
          // A newer in-memory edit was not part of the just-written snapshot.
          // Preserve its metadata and visible dirty state instead of claiming
          // that the disk now contains it.
          return { ...tab, path: targetPath, title, isDirty: true, diskFingerprint: savingFingerprint, diskBase: { content: savingDocument.content, metadata: sidecarContent } };
        }
        return {
          ...tab,
          path: targetPath,
          title,
          assetFolder: storedFormat.assetFolder,
          formatSettings,
          isDirty: false,
          savedRevision: savingRevision,
          diskFingerprint: savingFingerprint,
          diskBase: { content: savingDocument.content, metadata: sidecarContent },
          externalChange: null,
        };
      }));
      setWorkingTreeEpoch((epoch) => epoch + 1);
      rememberRecentFile(targetPath);
      // Callers that need a clean working tree (for example Create Version)
      // must retry after any edit that raced with this save.
      return snapshotWasCurrent;
    } catch (error) {
      window.alert(String(error));
      return false;
    }
    })().finally(() => savingDocumentsRef.current.delete(requestedId));
  }, [activeDocument.id, processExternalDocumentChange, rememberRecentFile, text.markdown, text.saveMarkdownDocument, text.untitledDocument]);

  useAgentBridge(startupReady, {
    documents: () => tabsRef.current.map((tab) => ({ id: tab.id, title: tab.title, path: tab.path,
      revision: `${tab.id}:${tab.editRevision}`, dirty: tab.isDirty, active: tab.id === activeDocument.id,
      externalChange: !!tab.externalChange, content: liveEditorsRef.current.get(tab.id)?.read() ?? tab.content,
    })),
    editor: (id) => liveEditorsRef.current.get(id),
    busy: (id) => savingDocumentsRef.current.has(id) || repositoryOperationRef.current || !!externalMerge || !!pendingClose,
    save: (id) => handleSave(id),
  });

  const reloadActiveDocumentFromDisk = useCallback(async () => {
    if (!activeDocument.path) throw new Error("当前文稿尚未保存。");
    await reloadDocumentFromDisk(activeDocument.id, activeDocument.path);
  }, [activeDocument.id, activeDocument.path, reloadDocumentFromDisk]);

  const reconcileOpenDocuments = useCallback(async (changedPaths: string[]) => {
    const normalize = (path: string) => path.replace(/^\\\\\?\\/, "").replace(/\\/g, "/");
    const changed = changedPaths.map(normalize);
    const open = tabsRef.current.filter((tab) => {
      if (!tab.path) return false;
      const path = normalize(tab.path);
      const directory = path.slice(0, path.lastIndexOf("/") + 1);
      return changed.some((item) => sameDocumentPath(item, path) || (tab.assetFolder && sameDocumentPath(item.slice(0, `${directory}assets/${tab.assetFolder}/`.length), `${directory}assets/${tab.assetFolder}/`)));
    });
    // Use the same content + sidecar baseline as native watcher events. Editing
    // may have continued while the repository operation was in flight.
    const results = await Promise.all(open.map((tab) => processExternalDocumentChange(tab.id, tab.path!)));
    const unreadable = open.filter((_, index) => !results[index]);
    if (unreadable.length) {
      // A confirmed repository update can delete/rename an open document. Keep
      // its in-memory copy visibly unsaved instead of presenting stale content
      // as if it were still saved on disk. The original save baseline remains.
      const ids = new Set(unreadable.map((tab) => tab.id));
      setTabs((current) => current.map((tab) => ids.has(tab.id) ? { ...tab, isDirty: true, editRevision: tab.editRevision + 1 } : tab));
      window.alert(text.remoteSync.reopenFailed(unreadable.map((tab) => tab.path!).join("\n")));
    }
    setWorkingTreeEpoch((epoch) => epoch + 1);
  }, [processExternalDocumentChange, text.remoteSync]);

  const handleUpdateWorkingDirectory = useCallback(async () => {
    if (!activeDocument.path || repositoryOperationRef.current) return;
    const path = activeDocument.path;
    try {
      await runRepositoryOperation(async () => {
        try {
          const result = await updateWorkingDirectory(platform.remoteGit, path, () => tabsRef.current.some((tab) => tab.isDirty), text.remoteSync);
          await reconcileOpenDocuments(result.changedPaths);
          window.alert(text.remoteSync.updatedDirectory);
        } finally {
          setHeadRevisionEpoch((epoch) => epoch + 1);
        }
      });
    } catch (error) {
      setSidebarOpen(true);
      setActiveFeatureId("version-control");
      window.alert(String(error));
    }
  }, [activeDocument.path, reconcileOpenDocuments, runRepositoryOperation, text.remoteSync]);

  const reloadExternalDocument = useCallback(async () => {
    if (!activeDocument.path) return;
    try {
      await reloadDocumentFromDisk(activeDocument.id, activeDocument.path);
      setDismissedExternalChangeKey(null);
    } catch (error) {
      window.alert(String(error));
    }
  }, [activeDocument.id, activeDocument.path, reloadDocumentFromDisk]);

  const saveExternalDocumentCopy = useCallback(async () => {
    if (!activeDocument.path || !activeDocument.externalChange) return;
    const chosenPath = await platform.dialogs.saveMarkdown({
      title: text.externalChangeSaveCopyTitle,
      defaultPath: text.externalChangeCopyDefaultName(activeDocument.title),
      filter: { name: text.markdown, extensions: ["md"] },
    });
    if (!chosenPath) return;
    const targetPath = chosenPath.endsWith(".md") ? chosenPath : `${chosenPath}.md`;
    if (sameDocumentPath(targetPath, activeDocument.path)) {
      window.alert(text.externalChangeCopySamePath);
      return;
    }
    try {
      await platform.files.writeMarkdown(targetPath, activeDocument.content);
      rememberRecentFile(targetPath);
      window.alert(text.externalChangeCopySaved(targetPath));
      await reloadExternalDocument();
    } catch (error) {
      window.alert(String(error));
    }
  }, [activeDocument, reloadExternalDocument, rememberRecentFile, text]);

  const openExternalChangeComparison = useCallback(() => {
    if (!activeDocument.externalChange) return;
    setDismissedExternalChangeKey(activeExternalChangeKey);
    setActiveVersionComparison({ initialPath: null, versionId: null, presentation: "rendered", externalChange: true });
  }, [activeDocument.externalChange, activeExternalChangeKey]);

  const openExternalMerge = useCallback(() => {
    const tab = tabsRef.current.find((tab) => tab.id === activeDocument.id);
    if (!tab?.path || !tab.externalChange || !tab.diskBase) return;
    setExternalMerge({ documentId: tab.id, path: tab.path, revision: tab.editRevision,
      base: tab.diskBase, local: diskSnapshot(tab), disk: {
        content: tab.externalChange.content,
        metadata: documentMetadata(tab.externalChange),
      } });
    setDismissedExternalChangeKey(activeExternalChangeKey);
  }, [activeDocument.id, activeExternalChangeKey]);

  const applyExternalMerge = useCallback(async (input: ExternalMergeInput, result: ExternalMergeResult) => {
    const stale = () => new Error(language === "zh" ? "文稿或磁盘又有了变化，请取消后重新合并。" : "The document or disk changed again. Cancel and reopen the merge.");
    const opened = tabsRef.current.find((tab) => tab.id === input.documentId);
    const fresh = opened ? alignLoadedDocument(opened, await loadDocumentFromDisk(input.path, opened.assetFolder)) : null;
    const tab = tabsRef.current.find((tab) => tab.id === input.documentId);
    const diskMetadata = fresh ? documentMetadata(fresh) : null;
    if (!tab || !fresh || tab.path !== input.path || tab.editRevision !== input.revision || fresh.content !== input.disk.content || !diskMetadata || !metadataEquivalent(diskMetadata, input.disk.metadata)) {
      await processExternalDocumentChange(input.documentId, input.path); throw stale();
    }
    const editor = liveEditorsRef.current.get(tab.id);
    if (!editor) throw new Error(language === "zh" ? "请先切回这篇文稿再合并。" : "Select this document before merging.");
    editor.replace(result.content, { before: documentMetadata(tab), after: result.metadata });
    setTabs((tabs) => tabs.map((current) => current.id !== tab.id ? current : {
      ...current, diskBase: input.disk, diskFingerprint: documentContentFingerprint(input.disk.content),
      externalChange: null, isDirty: true,
    }));
    setWorkingTreeEpoch((epoch) => epoch + 1);
  }, [language, processExternalDocumentChange, setTabs]);

  const planVersionRestore = useCallback(async (targetCommitId: string, targetTitle: string) => {
    if (!activeDocument.path) return;
    try {
      const preflight = await platform.versionControl.getRestorePreflight({
        documentPath: activeDocument.path,
        assetFolder: activeDocument.assetFolder,
        targetCommitId,
      });
      if (preflight.hasUnversionedScopeChanges) {
        setRestoreDialog({
          kind: "protect",
          targetCommitId,
          targetTitle: preflight.targetVersion.message || targetTitle,
          strategy: "save-current-version-first",
          safetyMessage: `恢复前保存：准备恢复至“${preflight.targetVersion.message || targetTitle}”`,
        });
      } else {
        setRestoreDialog({ kind: "confirm", targetCommitId, targetTitle: preflight.targetVersion.message || targetTitle });
      }
    } catch (error) {
      window.alert(String(error));
    }
  }, [activeDocument.assetFolder, activeDocument.path]);

  const requestVersionRestore = useCallback((targetCommitId: string, targetTitle: string) => {
    if (activeDocument.isDirty) {
      setRestoreDialog({ kind: "unsaved", targetCommitId, targetTitle });
      return;
    }
    void planVersionRestore(targetCommitId, targetTitle);
  }, [activeDocument.isDirty, planVersionRestore]);

  const performVersionRestore = useCallback(async () => {
    if (!restoreDialog || !activeDocument.path || isRestoringVersion || repositoryOperationRef.current) return;
    const documentPath = activeDocument.path;
    setIsRestoringVersion(true);
    try {
      const strategy = restoreDialog.kind === "protect" ? restoreDialog.strategy : "discard-current-changes";
      const safetyVersionMessage = restoreDialog.kind === "protect" && restoreDialog.strategy === "save-current-version-first"
        ? restoreDialog.safetyMessage
        : undefined;
      await runRepositoryOperation(async () => {
        const result = await platform.versionControl.restoreVersion({
          documentPath,
          assetFolder: activeDocument.assetFolder,
          targetCommitId: restoreDialog.targetCommitId,
          strategy,
          safetyVersionMessage,
        });
        await reloadActiveDocumentFromDisk();
        setHeadRevisionEpoch((epoch) => epoch + 1);
        setActiveVersionComparison(null);
        setRestoreDialog(null);
        window.alert(result.alreadyEquivalent ? text.versionAlreadyEquivalent : text.versionRestored);
      });
    } catch (error) {
      window.alert(String(error));
    } finally {
      setIsRestoringVersion(false);
    }
  }, [activeDocument.assetFolder, activeDocument.path, isRestoringVersion, reloadActiveDocumentFromDisk, restoreDialog, runRepositoryOperation, text.versionAlreadyEquivalent, text.versionRestored]);

  const handleSharePackage = useCallback(async () => {
    if (!activeDocument.path) {
      window.alert(text.sharePackageRequiresSave);
      return;
    }
    const destinationDir = await platform.dialogs.selectDirectory({
      title: text.chooseSharePackageDestination,
    });
    if (!destinationDir) return;

    try {
      const formatSettings = {
        ...activeDocument.formatSettings,
        documentFingerprint: documentContentFingerprint(activeDocument.content),
      };
      const sharePackage = await platform.files.exportSharePackage({
        documentPath: activeDocument.path,
        content: activeDocument.content,
        assetFolder: activeDocument.assetFolder,
        formatContent: serializeDocumentSidecar({
          schemaVersion: HAKUROU_SCHEMA_VERSION,
          document: activeDocument.document,
          assets: activeDocument.assets,
          format: formatSettings,
        }),
        destinationDir,
      });
      window.alert(text.sharePackageCreated(sharePackage.packagePath));
    } catch (error) {
      window.alert(String(error));
    }
  }, [activeDocument, text.chooseSharePackageDestination, text.sharePackageCreated, text.sharePackageRequiresSave]);

  const closeTab = useCallback((tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    if (tab.isDirty) {
      setPendingClose({ kind: "tab", tabId });
      return;
    }
    if (tabId === activeTabId) {
      setActiveVersionComparison(null);
      setActiveFeatureId(null);
      setSidebarOpen(true);
    }
    releaseRevisionDataForDocument(tab.path);
    releaseHistoricalAssetsForDocument(tab.path);
    const remainingTabs = tabs.filter((item) => item.id !== tabId);
    if (remainingTabs.length === 0) {
      const freshDocument = createDocument();
      setTabs([freshDocument]);
      setActiveTabId(freshDocument.id);
      return;
    }
    setTabs(remainingTabs);
    if (tabId === activeTabId) setActiveTabId(remainingTabs[Math.max(0, tabs.indexOf(tab) - 1)]!.id);
  }, [activeTabId, tabs]);

  const discardAndCloseTab = useCallback((tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    if (tabId === activeTabId) {
      setActiveVersionComparison(null);
      setActiveFeatureId(null);
      setSidebarOpen(true);
    }
    releaseRevisionDataForDocument(tab.path);
    releaseHistoricalAssetsForDocument(tab.path);
    const remainingTabs = tabs.filter((item) => item.id !== tabId);
    if (remainingTabs.length === 0) {
      const freshDocument = createDocument();
      setTabs([freshDocument]);
      setActiveTabId(freshDocument.id);
      return;
    }
    setTabs(remainingTabs);
    if (tabId === activeTabId) setActiveTabId(remainingTabs[Math.max(0, tabs.indexOf(tab) - 1)]!.id);
  }, [activeTabId, tabs]);

  const exitApplication = useCallback(() => {
    void platform.window.requestClose();
  }, []);

  const requestAppClose = useCallback(() => {
    if (softwareUpdate.controller.snapshot().phase === "installing") return;
    if (tabs.some((tab) => tab.isDirty)) {
      setPendingClose({ kind: "app" });
      return;
    }
    exitApplication();
  }, [exitApplication, tabs, softwareUpdate.controller]);

  const runEditCommand = useCallback((command: "undo" | "redo" | "cut" | "copy" | "paste") => {
    const editor = liveEditorsRef.current.get(activeDocument.id);
    if (editor && !activeVersionComparison && (command === "undo" || command === "redo")) {
      editor[command]();
      editor.focus();
    } else document.execCommand(command);
    setOpenMenu(null);
  }, [activeDocument.id, activeVersionComparison]);

  const handleWindowControl = useCallback(async (action: "minimize" | "maximize" | "close") => {
    if (action === "minimize") await platform.window.minimize();
    if (action === "maximize") await platform.window.toggleMaximize();
    if (action === "close") requestAppClose();
  }, [requestAppClose]);

  const startWindowDragging = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("button, .app-menu-popup")) return;
    void platform.window.startDragging();
  }, []);

  const toggleWindowMaximize = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, .app-menu-popup")) return;
    void handleWindowControl("maximize");
  }, [handleWindowControl]);

  const jumpToHeading = useCallback((headingIndex: number) => {
    const headings = document.querySelectorAll(".editor-stage .ProseMirror h1, .editor-stage .ProseMirror h2, .editor-stage .ProseMirror h3, .editor-stage .ProseMirror h4, .editor-stage .ProseMirror h5, .editor-stage .ProseMirror h6");
    headings.item(headingIndex)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const activeCollapsedHeadings = collapsedHeadings[activeDocument.id] ?? [];
  const toggleHeadingCollapse = useCallback((headingIndex: number) => {
    setCollapsedHeadings((current) => {
      const collapsed = new Set(current[activeDocument.id] ?? []);
      if (collapsed.has(headingIndex)) collapsed.delete(headingIndex);
      else collapsed.add(headingIndex);
      return { ...current, [activeDocument.id]: [...collapsed] };
    });
  }, [activeDocument.id]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (softwareUpdate.controller.snapshot().open) return;
      if (!event.isComposing && !activeVersionComparison && (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "m") { event.preventDefault(); setSourceMode((mode) => !mode); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void handleSave(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); createNewDocument(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); void handleOpen(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNewDocument, handleOpen, handleSave, softwareUpdate.controller, activeVersionComparison]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void platform.files.onMarkdownFileChanged((path) => {
      const tab = tabsRef.current.find((candidate) => candidate.path && sameDocumentPath(candidate.path, path));
      if (!tab) return;
      const currentTimer = externalChangeTimersRef.current.get(tab.id);
      if (currentTimer !== undefined) window.clearTimeout(currentTimer);
      externalChangeTimersRef.current.set(tab.id, window.setTimeout(() => {
        externalChangeTimersRef.current.delete(tab.id);
        void processExternalDocumentChange(tab.id, path);
      }, 350));
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    }).catch(console.error);
    return () => {
      disposed = true;
      unlisten?.();
      externalChangeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      externalChangeTimersRef.current.clear();
    };
  }, [processExternalDocumentChange]);

  const watchedMarkdownPathKey = useMemo(() => [...new Set(
    tabs.flatMap((tab) => tab.path ? [tab.path] : []),
  )].sort((left, right) => left.localeCompare(right)).join("\u0000"), [tabs]);

  useEffect(() => {
    const nextPaths = new Set(watchedMarkdownPathKey ? watchedMarkdownPathKey.split("\u0000") : []);
    markdownWatchQueueRef.current = markdownWatchQueueRef.current.catch(console.error).then(async () => {
      const currentPaths = watchedMarkdownPathsRef.current;
      for (const path of currentPaths) {
        if (!nextPaths.has(path)) await platform.files.unwatchMarkdownFile(path);
      }
      for (const path of nextPaths) {
        if (!currentPaths.has(path)) {
            await platform.files.watchMarkdownFile(path, tabsRef.current.find((tab) => tab.path === path)?.assetFolder);
          const tab = tabsRef.current.find((candidate) => candidate.path && sameDocumentPath(candidate.path, path));
          if (tab) await processExternalDocumentChange(tab.id, path);
        }
      }
      watchedMarkdownPathsRef.current = nextPaths;
    }).catch(console.error);
  }, [processExternalDocumentChange, watchedMarkdownPathKey]);

  useEffect(() => () => {
    const paths = [...watchedMarkdownPathsRef.current];
    watchedMarkdownPathsRef.current.clear();
    void Promise.all(paths.map((path) => platform.files.unwatchMarkdownFile(path).catch(console.error)));
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void platform.window.onCloseRequested(() => {
      if (softwareUpdate.controller.snapshot().phase === "installing") return;
      if (tabsRef.current.some((tab) => tab.isDirty)) setPendingClose({ kind: "app" });
      else exitApplication();
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [exitApplication, softwareUpdate.controller]);

  const isHeadingVisibleInOutline = useCallback((headingIndex: number) => {
    return !activeCollapsedHeadings.some((parentIndex) => {
      if (headingIndex <= parentIndex) return false;
      const parent = documentHeadings[parentIndex];
      const heading = documentHeadings[headingIndex];
      if (!parent || !heading || heading.level <= parent.level) return false;
      const intervening = documentHeadings.slice(parentIndex + 1, headingIndex);
      return !intervening.some((candidate) => candidate.level <= parent.level);
    });
  }, [activeCollapsedHeadings, documentHeadings]);

  useEffect(() => {
    const closeMenuOnOutsidePress = (event: PointerEvent) => {
      if (!menuListRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
        setRecentFilesMenuOpen(false);
        setViewSubmenu(null);
      }
    };
    window.addEventListener("pointerdown", closeMenuOnOutsidePress);
    return () => {
      window.removeEventListener("pointerdown", closeMenuOnOutsidePress);
      if (recentFilesMenuTimerRef.current !== null) window.clearTimeout(recentFilesMenuTimerRef.current);
      if (viewSubmenuTimerRef.current !== null) window.clearTimeout(viewSubmenuTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (openMenu !== "file") {
      setRecentFilesMenuOpen(false);
      if (recentFilesMenuTimerRef.current !== null) {
        window.clearTimeout(recentFilesMenuTimerRef.current);
        recentFilesMenuTimerRef.current = null;
      }
    }
  }, [openMenu]);

  useEffect(() => {
    if (openMenu === "view") return;
    setViewSubmenu(null);
    if (viewSubmenuTimerRef.current !== null) {
      window.clearTimeout(viewSubmenuTimerRef.current);
      viewSubmenuTimerRef.current = null;
    }
  }, [openMenu]);

  const openRecentFilesMenu = useCallback(() => {
    if (recentFilesMenuOpen || recentFilesMenuTimerRef.current !== null) return;
    recentFilesMenuTimerRef.current = window.setTimeout(() => {
      setRecentFilesMenuOpen(true);
      recentFilesMenuTimerRef.current = null;
    }, 250);
  }, [recentFilesMenuOpen]);

  const openViewSubmenuAfterDelay = useCallback((submenu: Exclude<ViewSubmenu, null>) => {
    if (viewSubmenu === submenu) return;
    if (viewSubmenuTimerRef.current !== null) {
      window.clearTimeout(viewSubmenuTimerRef.current);
      viewSubmenuTimerRef.current = null;
    }
    viewSubmenuTimerRef.current = window.setTimeout(() => {
      setViewSubmenu(submenu);
      viewSubmenuTimerRef.current = null;
    }, 250);
  }, [viewSubmenu]);

  const openViewSubmenuNow = useCallback((submenu: Exclude<ViewSubmenu, null>) => {
    if (viewSubmenuTimerRef.current !== null) {
      window.clearTimeout(viewSubmenuTimerRef.current);
      viewSubmenuTimerRef.current = null;
    }
    setViewSubmenu(submenu);
  }, []);

  const invokeMenuAction = (action: () => void) => {
    action();
    setOpenMenu(null);
    setRecentFilesMenuOpen(false);
    setViewSubmenu(null);
  };

  const fontPresetIsActive = (font: DocumentFontSettings | undefined, preset: DocumentFontSettings["preset"]) => font?.preset === preset;
  const renderFontOptions = (scope: AppearanceScope, selectedFont: DocumentFontSettings | undefined) => <>
    <button type="button" className={fontPresetIsActive(selectedFont, "standard") ? "is-active" : ""} onClick={() => applyFont(scope, fontForPreset("standard"))}>{text.standard}</button>
    <button type="button" className={fontPresetIsActive(selectedFont, "modern") ? "is-active" : ""} onClick={() => applyFont(scope, fontForPreset("modern"))}>{text.modern}</button>
    <button type="button" className={fontPresetIsActive(selectedFont, "elegant") ? "is-active" : ""} onClick={() => applyFont(scope, fontForPreset("elegant"))}>{text.elegant}</button>
    <button type="button" className={fontPresetIsActive(selectedFont, "custom") ? "is-active" : ""} onClick={() => openCustomFontDialog(scope)}>{text.custom}</button>
  </>;

  // Do not mount the welcome editor (or expose its tab and outline) until the
  // initial file request has completed. Later file opens keep the workspace visible.
  if (!startupReady) return <main className="app-shell app-startup" aria-busy="true">
    <header className="app-menubar" onMouseDown={startWindowDragging} onDoubleClick={toggleWindowMaximize}>
      <span className="app-startup-brand">HakurouPaper</span>
      <div className="window-controls">
        <button type="button" onClick={() => void handleWindowControl("minimize")} aria-label={text.minimize}>—</button>
        <button type="button" onClick={() => void handleWindowControl("maximize")} aria-label={text.maximize}>□</button>
        <button type="button" onClick={requestAppClose} aria-label={text.close}>×</button>
      </div>
    </header>
    <div className="app-startup-status" role="status">{text.startupLoading}</div>
  </main>;

  return (
    <main className="app-shell">
        <header className="app-menubar" onMouseDown={startWindowDragging} onDoubleClick={toggleWindowMaximize}>
          <nav className="app-menu-list" ref={menuListRef} aria-label={text.applicationMenu}>
            <span className="app-brand-mark" role="img" aria-label="HakurouPaper" title="HakurouPaper">
              <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
                <defs>
                  <filter id="hakurou-brand-mark-alpha">
                    <feColorMatrix type="matrix" values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 5 -1.5 -1.5 0 -1" />
                  </filter>
                </defs>
                <image href={hakurouAppIcon} width="100" height="100" preserveAspectRatio="xMidYMid meet" filter="url(#hakurou-brand-mark-alpha)" />
              </svg>
            </span>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}>{text.file}</button>
              {openMenu === "file" && <div className="app-menu-popup">
                <button type="button" onClick={() => invokeMenuAction(createNewDocument)}>{text.newDocument} <kbd>Ctrl N</kbd></button>
                <button type="button" onClick={() => invokeMenuAction(() => void handleOpen())}>{text.openDocument} <kbd>Ctrl O</kbd></button>
                <div className={`app-menu-submenu ${recentFilesMenuOpen ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={recentFilesMenuOpen} onMouseEnter={openRecentFilesMenu} onClick={() => setRecentFilesMenuOpen(true)}>{text.recentFiles} <span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup" aria-label={text.recentFilesList}>
                    {recentFiles.length > 0 ? recentFiles.map((file) => (
                      <button key={file.path} type="button" title={file.path} onClick={() => invokeMenuAction(() => void openDocumentPath(file.path))}>
                        <span className="recent-file-label">{file.title}</span>
                      </button>
                    )) : <span className="app-menu-empty">{text.noRecentFiles}</span>}
                  </div>
                </div>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => invokeMenuAction(() => void handleSave())}>{text.save} <kbd>Ctrl S</kbd></button>
                <button type="button" onClick={() => invokeMenuAction(() => void handleSharePackage())}>{text.sharePackage}</button>
                <button type="button" disabled={!activeDocument.path || repositoryBusy} onClick={() => invokeMenuAction(() => void handleUpdateWorkingDirectory())}>{text.remoteSync.pull}</button>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => invokeMenuAction(() => closeTab(activeTabId))}>{text.closeDocument} <kbd>Ctrl W</kbd></button>
              </div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}>{text.edit}</button>
              {openMenu === "edit" && <div className="app-menu-popup">
                <button type="button" onClick={() => runEditCommand("undo")}>{text.undo} <kbd>Ctrl Z</kbd></button>
                <button type="button" onClick={() => runEditCommand("redo")}>{text.redo} <kbd>Ctrl Y</kbd></button>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => runEditCommand("cut")}>{text.cut} <kbd>Ctrl X</kbd></button>
                <button type="button" onClick={() => runEditCommand("copy")}>{text.copy} <kbd>Ctrl C</kbd></button>
                <button type="button" onClick={() => runEditCommand("paste")}>{text.paste} <kbd>Ctrl V</kbd></button>
              </div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "view" ? null : "view")}>{text.view}</button>
              {openMenu === "view" && <div className="app-menu-popup app-view-menu-popup">
                <div className={`app-menu-submenu appearance-submenu ${viewSubmenu === "document-font" ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={viewSubmenu === "document-font"} onMouseEnter={() => openViewSubmenuAfterDelay("document-font")} onClick={() => openViewSubmenuNow("document-font")}><span>{text.documentFont}</span><span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup appearance-submenu-popup">{renderFontOptions("document", effectiveDocumentDefaults.font)}</div>
                </div>
                <div className={`app-menu-submenu appearance-submenu ${viewSubmenu === "document-table" ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={viewSubmenu === "document-table"} onMouseEnter={() => openViewSubmenuAfterDelay("document-table")} onClick={() => openViewSubmenuNow("document-table")}><span>{text.documentTable}</span><span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup appearance-submenu-popup">
                    <button type="button" className={effectiveDocumentDefaults.tableStyle === "standard" ? "is-active" : ""} onClick={() => applyTableStyle("document", "standard")}>{text.standardTable}</button>
                    <button type="button" className={effectiveDocumentDefaults.tableStyle === "three-line" ? "is-active" : ""} onClick={() => applyTableStyle("document", "three-line")}>{text.threeLineTable}</button>
                  </div>
                </div>
                <div className={`app-menu-submenu appearance-submenu ${viewSubmenu === "document-indent" ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={viewSubmenu === "document-indent"} onMouseEnter={() => openViewSubmenuAfterDelay("document-indent")} onClick={() => openViewSubmenuNow("document-indent")}><span>{text.documentIndent}</span><span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup appearance-submenu-popup">
                    <button type="button" className={!effectiveDocumentDefaults.firstLineIndent ? "is-active" : ""} onClick={() => applyFirstLineIndent("document", false)}>{text.noIndent}</button>
                    <button type="button" className={effectiveDocumentDefaults.firstLineIndent ? "is-active" : ""} onClick={() => applyFirstLineIndent("document", true)}>{text.firstLineIndentTwoCharacters}</button>
                  </div>
                </div>
                <span className="app-menu-separator" />
                <div className={`app-menu-submenu appearance-submenu ${viewSubmenu === "application-font" ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={viewSubmenu === "application-font"} onMouseEnter={() => openViewSubmenuAfterDelay("application-font")} onClick={() => openViewSubmenuNow("application-font")}><span>{text.defaultFont}</span><span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup appearance-submenu-popup">{renderFontOptions("application", applicationAppearance.font)}</div>
                </div>
                <div className={`app-menu-submenu appearance-submenu ${viewSubmenu === "application-table" ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={viewSubmenu === "application-table"} onMouseEnter={() => openViewSubmenuAfterDelay("application-table")} onClick={() => openViewSubmenuNow("application-table")}><span>{text.defaultTable}</span><span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup appearance-submenu-popup">
                    <button type="button" className={applicationAppearance.tableStyle === "standard" ? "is-active" : ""} onClick={() => applyTableStyle("application", "standard")}>{text.standardTable}</button>
                    <button type="button" className={applicationAppearance.tableStyle === "three-line" ? "is-active" : ""} onClick={() => applyTableStyle("application", "three-line")}>{text.threeLineTable}</button>
                  </div>
                </div>
                <div className={`app-menu-submenu appearance-submenu ${viewSubmenu === "application-indent" ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={viewSubmenu === "application-indent"} onMouseEnter={() => openViewSubmenuAfterDelay("application-indent")} onClick={() => openViewSubmenuNow("application-indent")}><span>{text.defaultIndent}</span><span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup appearance-submenu-popup">
                    <button type="button" className={!applicationAppearance.firstLineIndent ? "is-active" : ""} onClick={() => applyFirstLineIndent("application", false)}>{text.noIndent}</button>
                    <button type="button" className={applicationAppearance.firstLineIndent ? "is-active" : ""} onClick={() => applyFirstLineIndent("application", true)}>{text.firstLineIndentTwoCharacters}</button>
                  </div>
                </div>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => invokeMenuAction(toggleDocumentSidebar)}>{text.documentPanel} <kbd>Ctrl Shift B</kbd></button>
                <button type="button" role="menuitemcheckbox" aria-checked={sourceMode} disabled={Boolean(activeVersionComparison)} onClick={() => invokeMenuAction(() => setSourceMode((mode) => !mode))}>{text.sourceEditing} <kbd>Ctrl Shift M</kbd></button>
                <button type="button" role="menuitemcheckbox" aria-checked={showLineNumbers} title={text.sourceLineNumbersDescription} className={showLineNumbers ? "is-active" : ""} onClick={() => invokeMenuAction(() => setShowLineNumbers((visible) => !visible))}><span>{text.sourceLineNumbers}</span><span aria-hidden="true">{showLineNumbers ? "✓" : ""}</span></button>
              </div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "window" ? null : "window")}>{text.window}</button>
              {openMenu === "window" && <div className="app-menu-popup"><button type="button" onClick={() => invokeMenuAction(() => void handleWindowControl("minimize"))}>{text.minimize}</button></div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}>{text.help}</button>
              {openMenu === "help" && <div className="app-menu-popup">
                <button type="button" onClick={() => invokeMenuAction(() => void softwareUpdate.controller.check(true))}>{text.softwareUpdate.menu}</button>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => invokeMenuAction(() => window.alert(text.aboutMessage))}>{text.about}</button>
              </div>}
            </div>
          </nav>
          <div className="app-header-actions">
            <div className="language-switch" role="group" aria-label={text.language}>
              <button type="button" className={language === "zh" ? "is-active" : ""} aria-pressed={language === "zh"} onClick={() => setLanguage("zh")}>中</button>
              <button type="button" className={language === "en" ? "is-active" : ""} aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
            </div>
            <div className="window-controls">
              <button type="button" onClick={() => void handleWindowControl("minimize")} aria-label={text.minimize}>—</button>
              <button type="button" onClick={() => void handleWindowControl("maximize")} aria-label={text.maximize}>□</button>
              <button type="button" className="window-close" onClick={() => void handleWindowControl("close")} aria-label={text.close}>×</button>
            </div>
          </div>
        </header>

        <div className="workspace-tabs" role="tablist" aria-label={text.openedDocuments}>
          <div className="tab-rail-spacer" aria-hidden="true" />
          <div className="workspace-tab-scroll">
            {tabs.map((tab) => (
              <div className={`workspace-tab-shell ${tab.id === activeTabId ? "is-active" : ""}`} key={tab.id}>
                <button type="button" className="workspace-tab" role="tab" aria-selected={tab.id === activeTabId} onClick={() => activateDocument(tab.id)}>
                  <span className={`workspace-tab-dirty ${tab.isDirty ? "is-visible" : ""}`} aria-label={tab.isDirty ? text.unsaved : undefined} />
                  <span className="workspace-tab-label">{tab.title}</span>
                </button>
                <button type="button" className="workspace-tab-close" onClick={() => closeTab(tab.id)} aria-label={text.closeDocumentWithTitle(tab.title)}>×</button>
              </div>
            ))}
          </div>
          <div className="editor-mode-switch" role="group" aria-label={text.editorMode}>
            <button type="button" aria-pressed={!sourceMode} disabled={Boolean(activeVersionComparison)} onClick={() => setSourceMode(false)}>{text.visualEditing}</button>
            <button type="button" aria-pressed={sourceMode} disabled={Boolean(activeVersionComparison)} title="Ctrl Shift M" onClick={() => setSourceMode(true)}>{text.sourceEditing}</button>
          </div>
        </div>

        <div className={`workspace-layout ${ActiveFeatureWorkspace ? "has-feature-sidebar" : sidebarOpen ? "has-sidebar" : ""}`}>
          <aside className="app-rail" aria-label={text.workspaceNavigation}>
            <button type="button" className={`rail-button ${!activeFeature && sidebarOpen ? "is-active" : ""}`} onClick={toggleDocumentSidebar} title={text.outline} aria-label={text.outline}><OutlineRailIcon /></button>
            {featureRegistry.sidebarContributions.map((contribution) => (
              (() => {
                const FeatureIcon = contribution.Icon;
                return <button
                  type="button"
                  key={contribution.id}
                  className={`rail-button ${activeFeature?.id === contribution.id ? "is-active" : ""}`}
                  onClick={() => {
                    setSidebarOpen(true);
                    setActiveFeatureId((current) => current === contribution.id ? null : contribution.id);
                  }}
                  title={contribution.label(text)}
                  aria-label={contribution.label(text)}
                ><FeatureIcon /></button>;
              })()
            ))}
          </aside>
          {ActiveFeatureWorkspace ? <aside className="feature-sidebar" aria-label={activeFeature?.label(text)}>
            <ActiveFeatureWorkspace document={featureDocument} text={text} onSaveDocument={handleSave} repositoryBusy={repositoryBusy} runRepositoryOperation={runRepositoryOperation} hasUnsavedDocuments={tabs.some((tab) => tab.isDirty)} onDiskDocumentsChanged={reconcileOpenDocuments} showRevisionChanges={showRevisionChanges} onShowRevisionChangesChange={setShowRevisionChanges} onVersionStateChanged={() => setHeadRevisionEpoch((epoch) => epoch + 1)} onOpenVersionDiff={openVersionDiff} onOpenVersionHistoryComparison={openVersionHistoryComparison} />
          </aside> : sidebarOpen && <aside className="document-sidebar" aria-label={text.documentList}>
            {documentHeadings.length > 0 && <>
              <div className="sidebar-heading sidebar-outline-heading"><span>{text.outline}</span></div>
              <div className="sidebar-outline-list">
                {documentHeadings.map((heading, index) => isHeadingVisibleInOutline(index) && (
                  <div className={`sidebar-outline-row level-${Math.min(heading.level, 3)}`} key={`${heading.title}-${index}`}>
                    {heading.canCollapse && <button
                      type="button"
                      className="sidebar-outline-toggle"
                      onClick={() => toggleHeadingCollapse(index)}
                      title={activeCollapsedHeadings.includes(index) ? text.expandHeading : text.collapseHeading}
                      aria-label={activeCollapsedHeadings.includes(index) ? text.expandHeading : text.collapseHeading}
                    >{activeCollapsedHeadings.includes(index) ? "▸" : "▾"}</button>}
                    <button
                      type="button"
                      className="sidebar-outline-item"
                      onClick={() => jumpToHeading(index)}
                      title={heading.title}
                    >{heading.title}</button>
                  </div>
                ))}
              </div>
            </>}
          </aside>}
          <section ref={editorStageRef} className={`editor-stage${showLineNumbers ? " has-line-numbers" : ""}`} aria-label={text.editingArea} style={documentFontStyle} hidden={Boolean(activeVersionComparison)}>
              <WritingEditor
                key={activeDocument.id}
                sourceMode={sourceMode}
                documentId={activeDocument.id}
                markdown={activeDocument.content}
                showLineNumbers={showLineNumbers}
                documentLoadRevision={activeDocument.documentLoadRevision}
                onContentChange={updateDocument}
                onEditorReady={registerEditor}
                onHistoryContext={applyHistoryContext}
                documentPath={activeDocument.path}
                assetFolder={activeDocument.assetFolder}
                assets={activeDocument.assets}
                onAssetImported={updateDocumentAsset}
                onAssetResize={resizeDocumentAsset}
                formatSettings={activeDocument.formatSettings}
                onFormatChange={updateDocumentFormatSettings}
                onSelectionChange={updateSelectedText}
                text={text}
                tableStyle={effectiveDocumentDefaults.tableStyle}
                firstLineIndent={effectiveDocumentDefaults.firstLineIndent}
                showRevisionChanges={showRevisionChanges}
                revisionLocations={revisionLocations}
                revisionBaselineKey={`${activeDocument.path ?? ""}\u0000${activeDocument.assetFolder ?? ""}\u0000${headRevisionEpoch}`}
                onOpenRevisionPreview={openRevisionPreviewAtLocation}
              />
          </section>
          {activeVersionComparison?.presentation === "rendered" && <RenderedRevisionViewer
            document={featureDocument}
            versionId={activeVersionComparison.versionId}
            initialLocation={activeVersionComparison.focusLocation}
            text={text}
            onClose={closeVersionDiff}
            onOpenAdvanced={openAdvancedVersionComparison}
            onRestoreVersion={requestVersionRestore}
            directComparison={activeVersionComparison.externalChange ? externalChangeComparison : undefined}
          />}
          {activeVersionComparison?.presentation === "source" && <VersionDiffViewer document={featureDocument} initialPath={activeVersionComparison.initialPath} versionId={activeVersionComparison.versionId} text={text} onClose={closeVersionDiff} onRestoreVersion={requestVersionRestore} />}
        </div>

        <footer className="statusbar">
          <span className="save-state"><i className={`save-state-dot ${activeDocument.isDirty ? "is-dirty" : "is-saved"}`} />{activeDocument.isDirty ? text.unsavedChanges : activeDocument.path ? text.savedLocally : text.localDraft}{activeDocument.externalChange && <button type="button" className="external-change-status" onClick={() => setDismissedExternalChangeKey(null)}>{text.externalChangeStatus}</button>}{selectedText && <span className="selection-count">{text.selectedCount(countWords(selectedText))}</span>}</span>
          <span className="status-document-stats">
            <span>{text.documentStats(countWords(activeDocument.content), activeDocument.content.trim().length)}</span>
          </span>
        </footer>
        <SoftwareUpdateDialog state={softwareUpdate.state} controller={softwareUpdate.controller} text={text.softwareUpdate} block={updateInstallationBlock} />
        {externalChangeDialogVisible && activeDocument.externalChange && <div className="close-confirm-backdrop" role="presentation">
          <section className="close-confirm-dialog external-change-dialog" role="dialog" aria-modal="true" aria-labelledby="external-change-title">
            <h2 id="external-change-title">{text.externalChangeDetected}</h2>
            <p>{text.externalChangeDescription(activeDocument.title)}</p>
            <div className="external-change-actions">
              {activeDocument.diskBase && <button type="button" onClick={openExternalMerge}>{language === "zh" ? "合并双方修改" : "Merge both versions"}</button>}
              <button type="button" onClick={() => setDismissedExternalChangeKey(activeExternalChangeKey)}>{text.externalChangeContinueEditing}</button>
              <button type="button" onClick={openExternalChangeComparison}>{text.externalChangeViewComparison}</button>
              <button type="button" onClick={() => void saveExternalDocumentCopy()}>{text.externalChangeSaveCopy}</button>
              <button type="button" className="is-danger" onClick={() => void reloadExternalDocument()}>{text.externalChangeReloadFromDisk}</button>
            </div>
          </section>
        </div>}
        {externalMerge && <ExternalMergeDialog key={`${externalMerge.documentId}:${externalMerge.revision}`} input={externalMerge} language={language} onApply={applyExternalMerge} onClose={() => setExternalMerge(null)} />}
        {pendingClose && <div className="close-confirm-backdrop" role="presentation">
          <section className="close-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title">
            <h2 id="close-confirm-title">{pendingClose.kind === "app" ? text.unsavedDocuments : text.unsavedDocument}</h2>
            <p>{pendingClose.kind === "app" ? text.confirmCloseApplication : text.confirmCloseDocument(tabs.find((tab) => tab.id === pendingClose.tabId)?.title ?? text.untitledDocument)}</p>
            <div className="close-confirm-actions">
              <button type="button" onClick={() => setPendingClose(null)}>{text.returnToEditing}</button>
              <button type="button" className="is-danger" onClick={() => {
                if (pendingClose.kind === "tab") discardAndCloseTab(pendingClose.tabId);
                else exitApplication();
                setPendingClose(null);
              }}>{text.discardAndClose}</button>
            </div>
          </section>
        </div>}
        {restoreDialog && <div className="close-confirm-backdrop" role="presentation">
          <section className="close-confirm-dialog restore-version-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-version-title">
            {restoreDialog.kind === "unsaved" && <>
              <h2 id="restore-version-title">{text.versionRestoreUnsaved}</h2>
              <p>{text.versionRestoreDescription(restoreDialog.targetTitle)}</p>
              <div className="close-confirm-actions">
                <button type="button" onClick={() => setRestoreDialog(null)}>{text.cancel}</button>
                <button type="button" className="is-confirm" onClick={() => void (async () => {
                  const target = restoreDialog;
                  const saved = await handleSave();
                  if (saved) {
                    setRestoreDialog(null);
                    await planVersionRestore(target.targetCommitId, target.targetTitle);
                  }
                })()}>{text.versionSaveDocumentAndContinue}</button>
              </div>
            </>}
            {restoreDialog.kind === "confirm" && <>
              <h2 id="restore-version-title">{text.versionRestoreTitle}</h2>
              <p>{text.versionRestoreDescription(restoreDialog.targetTitle)}</p>
              <div className="close-confirm-actions">
                <button type="button" disabled={isRestoringVersion} onClick={() => setRestoreDialog(null)}>{text.cancel}</button>
                <button type="button" className="is-confirm" disabled={isRestoringVersion} onClick={() => void performVersionRestore()}>{isRestoringVersion ? text.versionRestoring : text.versionRestoreThis}</button>
              </div>
            </>}
            {restoreDialog.kind === "protect" && <>
              <h2 id="restore-version-title">{text.versionRestoreProtectionTitle}</h2>
              <p>{text.versionRestoreProtectionDescription}</p>
              <label className="restore-strategy-option">
                <input type="radio" name="restore-strategy" checked={restoreDialog.strategy === "save-current-version-first"} onChange={() => setRestoreDialog((current) => current?.kind === "protect" ? { ...current, strategy: "save-current-version-first" } : current)} />
                <span><strong>{text.versionRestoreSaveFirst}</strong><small>{text.versionDescription}</small></span>
              </label>
              {restoreDialog.strategy === "save-current-version-first" && <label className="restore-message-field"><span>{text.versionRestoreBeforeMessage}</span><input value={restoreDialog.safetyMessage} maxLength={160} onChange={(event) => setRestoreDialog((current) => current?.kind === "protect" ? { ...current, safetyMessage: event.target.value } : current)} /></label>}
              <label className="restore-strategy-option is-danger">
                <input type="radio" name="restore-strategy" checked={restoreDialog.strategy === "discard-current-changes"} onChange={() => setRestoreDialog((current) => current?.kind === "protect" ? { ...current, strategy: "discard-current-changes" } : current)} />
                <span><strong>{text.versionRestoreDiscard}</strong><small>{text.versionRestoreDiscardWarning}</small></span>
              </label>
              <div className="close-confirm-actions">
                <button type="button" disabled={isRestoringVersion} onClick={() => setRestoreDialog(null)}>{text.cancel}</button>
                <button type="button" className="is-confirm" disabled={isRestoringVersion || (restoreDialog.strategy === "save-current-version-first" && !restoreDialog.safetyMessage.trim())} onClick={() => void performVersionRestore()}>{isRestoringVersion ? text.versionRestoring : text.versionRestoreContinue}</button>
              </div>
            </>}
          </section>
        </div>}
        {customFontTarget && <div className="close-confirm-backdrop font-settings-backdrop" role="presentation">
          <form className="font-settings-dialog" onSubmit={(event) => { event.preventDefault(); applyCustomFont(); }}>
            <h2 id="font-settings-title">{customFontTarget === "document" ? text.customDocumentFont : text.customApplicationFont}</h2>
            <p>{text.customFontDescription}</p>
            <label>
              <span>{text.chineseFont}</span>
              <input value={customFontDraft.chineseFamily} onChange={(event) => setCustomFontDraft((current) => ({ ...current, chineseFamily: event.target.value }))} placeholder={fontFamiliesForInput(customFontDraft.baseFont).chinese} autoFocus />
            </label>
            <label>
              <span>{text.latinFont}</span>
              <input value={customFontDraft.latinFamily} onChange={(event) => setCustomFontDraft((current) => ({ ...current, latinFamily: event.target.value }))} placeholder={fontFamiliesForInput(customFontDraft.baseFont).latin} />
            </label>
            <label>
              <span>{text.fontWeight}</span>
              <select value={customFontDraft.weight} onChange={(event) => setCustomFontDraft((current) => ({ ...current, weight: Number(event.target.value) as DocumentFontWeight }))}>
                <option value={300}>{text.fontWeightLight}</option>
                <option value={400}>{text.fontWeightRegular}</option>
                <option value={500}>{text.fontWeightMedium}</option>
                <option value={600}>{text.fontWeightSemibold}</option>
                <option value={700}>{text.fontWeightBold}</option>
              </select>
              <small>{text.fontWeightNote}</small>
            </label>
            <div className="font-settings-preview" style={{ fontFamily: fontFamilyStack(customFontDraft.chineseFamily.trim() || customFontDraft.latinFamily.trim()
              ? { preset: "custom", weight: customFontDraft.weight, chineseFamily: customFontDraft.chineseFamily.trim() || fontFamiliesForInput(customFontDraft.baseFont).chinese, latinFamily: customFontDraft.latinFamily.trim() || fontFamiliesForInput(customFontDraft.baseFont).latin }
              : { ...customFontDraft.baseFont, weight: customFontDraft.weight }), fontWeight: customFontDraft.weight }}>
              <span>{text.chineseFontPreview}</span>
              <span>{text.latinFontPreview}</span>
            </div>
            <div className="close-confirm-actions">
              <button type="button" onClick={() => setCustomFontTarget(null)}>{text.cancel}</button>
              <button type="submit" className="is-confirm">{text.apply}</button>
            </div>
          </form>
        </div>}
    </main>
  );
}

export default App;
