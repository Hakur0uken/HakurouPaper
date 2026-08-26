import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/core";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { nord } from "@milkdown/theme-nord";
import { EditorControls } from "./EditorControls";
import { uiText, type UiLanguage, type UiText } from "./i18n";
import { createImageAssetPlugins } from "./editor/image";
import { formulaPlugins } from "./math";
import { HAKUROU_SCHEMA_VERSION, collectDocumentImageAssets, createDocumentSchema, parseDocumentSidecar, serializeDocumentSidecar, type AssetV1, type DocumentV1 } from "./core/schema";
import { platform } from "./platform";
import { spreadsheetTablePastePlugin } from "./spreadsheetTablePaste";
import { createTableDecorationPlugin, setTableDefaultStyle, tableDefaultStylePluginKey } from "./tableDecorations";
import { createTextLayoutPlugin, setTextDefaultFirstLineIndent, textDefaultLayoutPluginKey } from "./textLayout";
import { collectDocumentFormatSettings, collectUnresolvedDocumentFormatSettings, documentFormattingChanged } from "./formatPersistence";
import { documentContentFingerprint, emptyDocumentFormatSettings, parseDocumentFormatSettings, removeLegacyFormatMarkers, type DocumentFontSettings, type DocumentFormatDefaults, type DocumentFormatSettings, type DocumentFontWeight } from "./formatTypes";
import { fontFamiliesForInput, fontFamilyStack, fontForPreset, readApplicationAppearance, writeApplicationAppearance, type ApplicationAppearanceSettings, type TableStyle } from "./appearanceSettings";
import hakurouAppIcon from "./assets/hakurou-paper-icon.png";
import "./App.css";
import "./hakurou.css";

const starterDocument = `# 未命名文稿

从这里开始写作。HakurouPaper 会将你的内容保存为标准 Markdown 文件，让它能在 Typora、VS Code 和任何支持 Markdown 的工具中继续使用。
`;

type DocumentTab = {
  id: string;
  title: string;
  path: string | null;
  content: string;
  initialContent: string;
  isDirty: boolean;
  assetFolder: string | null;
  document: DocumentV1;
  assets: AssetV1[];
  formatSettings: DocumentFormatSettings;
};

type WritingEditorProps = {
  documentId: string;
  initialContent: string;
  onContentChange: (documentId: string, markdown: string) => void;
  documentPath: string | null;
  assetFolder: string | null;
  onAssetImported: (documentId: string, asset: AssetV1, folder: string) => void;
  formatSettings: DocumentFormatSettings;
  onFormatChange: (documentId: string, settings: DocumentFormatSettings) => void;
  onSelectionChange: (text: string | null) => void;
  text: UiText;
  tableStyle: TableStyle;
  firstLineIndent: boolean;
};

type DocumentHeading = {
  level: number;
  title: string;
  canCollapse: boolean;
};

type PendingClose = { kind: "tab"; tabId: string } | { kind: "app" } | null;

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

function createDocument(
  markdown = starterDocument,
  path: string | null = null,
  title = "未命名文稿",
  options: { assetFolder?: string | null; document?: DocumentV1; assets?: AssetV1[]; formatSettings?: DocumentFormatSettings } = {},
): DocumentTab {
  return {
    id: crypto.randomUUID(),
    title,
    path,
    content: markdown,
    initialContent: markdown,
    isDirty: false,
    assetFolder: options.assetFolder ?? findAssetFolder(markdown),
    document: options.document ?? createDocumentSchema(),
    assets: options.assets ?? [],
    formatSettings: options.formatSettings ?? emptyDocumentFormatSettings(),
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

function WritingEditor({ documentId, initialContent, onContentChange, documentPath, assetFolder, onAssetImported, formatSettings, onFormatChange, onSelectionChange, text, tableStyle, firstLineIndent }: WritingEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [editorView, setEditorView] = useState<import("@milkdown/prose/view").EditorView | null>(null);
  const unresolvedFormatSettingsRef = useRef(emptyDocumentFormatSettings());
  const currentFormatSettingsRef = useRef(formatSettings);
  currentFormatSettingsRef.current = formatSettings;

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
              onFormatChange(documentId, collectDocumentFormatSettings(nextView.state, unresolvedFormatSettingsRef.current, currentFormatSettingsRef.current.defaults));
            }
          },
          destroy: () => {
            if (!disposed) setEditorView(null);
          },
        };
      },
    }));
    const editor = Editor.make();
    editor
      .config(nord)
      .config((ctx) => {
        ctx.set(rootCtx, editorHost);
        ctx.set(defaultValueCtx, initialContent);
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => onContentChange(documentId, markdown));
      })
      .use(commonmark)
      .use(gfm)
      .use(spreadsheetTablePastePlugin)
      .use(history)
      .use(listener)
      .use(formulaPlugins)
      .use(createImageAssetPlugins(
        {
          documentPath,
          assetFolder,
          assets: platform.assets,
          onAssetImported: (asset, folder) => onAssetImported(documentId, asset, folder),
          onImportError: (error) => window.alert(String(error)),
        },
      ))
      .use(createTableDecorationPlugin(currentFormatSettingsRef.current, tableStyle))
      .use(createTextLayoutPlugin(currentFormatSettingsRef.current, firstLineIndent))
      .use(editorControlsBridge);
    void editor.create().catch(console.error);
    return () => {
      disposed = true;
      setEditorView(null);
      void editor.destroy().catch(console.error);
      if (mount.contains(editorHost)) mount.replaceChildren();
    };
  }, [documentId, documentPath, initialContent, onAssetImported, onContentChange, onFormatChange]);

  useEffect(() => {
    if (!editorView) return;
    editorView.dispatch(editorView.state.tr.setMeta(tableDefaultStylePluginKey, setTableDefaultStyle(tableStyle)));
  }, [editorView, tableStyle]);

  useEffect(() => {
    if (!editorView) return;
    editorView.dispatch(editorView.state.tr.setMeta(textDefaultLayoutPluginKey, setTextDefaultFirstLineIndent(firstLineIndent)));
  }, [editorView, firstLineIndent]);

  return <div className="writing-editor-root"><div ref={mountRef} data-milkdown-root="true" /><EditorControls view={editorView} onSelectionChange={onSelectionChange} text={text} /></div>;
}

function App() {
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [createDocument()]);
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
  const [customFontDraft, setCustomFontDraft] = useState<CustomFontDraft>({ chineseFamily: "", latinFamily: "", weight: 400, baseFont: fontForPreset("elegant") });
  const menuListRef = useRef<HTMLElement>(null);
  const tabsRef = useRef(tabs);
  const recentFilesMenuTimerRef = useRef<number | null>(null);
  const viewSubmenuTimerRef = useRef<number | null>(null);

  const activeDocument = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!,
    [activeTabId, tabs],
  );
  const text = uiText[language];
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
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === documentId ? { ...tab, content: markdown, assetFolder: tab.assetFolder ?? findAssetFolder(markdown), isDirty: true } : tab
    )));
  }, []);

  const updateDocumentAsset = useCallback((documentId: string, asset: AssetV1, assetFolder: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== documentId) return tab;
      const assets = [...tab.assets.filter((current) => current.assetId !== asset.assetId), asset];
      return { ...tab, assets, assetFolder, isDirty: true };
    }));
  }, []);

  const updateDocumentFormatSettings = useCallback((documentId: string, settings: DocumentFormatSettings) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== documentId) return tab;
      const nextSettings = { ...settings, ...(tab.formatSettings.documentFingerprint ? { documentFingerprint: tab.formatSettings.documentFingerprint } : {}) };
      const { documentFingerprint: _currentFingerprint, ...currentComparable } = tab.formatSettings;
      const { documentFingerprint: _nextFingerprint, ...nextComparable } = nextSettings;
      if (JSON.stringify(currentComparable) === JSON.stringify(nextComparable)) return tab;
      return { ...tab, formatSettings: nextSettings, isDirty: true };
    }));
  }, []);

  const updateActiveDocumentDefaults = useCallback((updates: Partial<DocumentFormatDefaults>) => {
    setTabs((currentTabs) => currentTabs.map((tab) => {
      if (tab.id !== activeDocument.id) return tab;
      const defaults = { ...tab.formatSettings.defaults, ...updates };
      if (JSON.stringify(defaults) === JSON.stringify(tab.formatSettings.defaults)) return tab;
      return { ...tab, formatSettings: { ...tab.formatSettings, defaults }, isDirty: true };
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
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === documentId ? { ...tab, initialContent: tab.content } : tab
    )));
    setActiveTabId(documentId);
  }, []);

  const createNewDocument = useCallback(() => {
    const document = createDocument();
    setTabs((currentTabs) => [...currentTabs, document]);
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

  const addOpenedDocument = useCallback((markdown: string, path: string, formatSettings: DocumentFormatSettings, assetFolder: string | null, documentSchema: DocumentV1, assets: AssetV1[]) => {
    const existingDocument = tabs.find((tab) => tab.path === path);
    if (existingDocument) {
      activateDocument(existingDocument.id);
      return;
    }
    const filename = filenameFromPath(path);
    const document = createDocument(markdown, path, filename.replace(/\.(md|markdown|mdx)$/i, ""), { formatSettings, assetFolder, document: documentSchema, assets });
    if (tabs.length === 1 && isPristineWelcomeDocument(tabs[0]!)) {
      const welcomeDocument = tabs[0]!;
      setTabs([{ ...document, id: welcomeDocument.id }]);
      setActiveTabId(welcomeDocument.id);
      return;
    }
    setTabs((currentTabs) => [...currentTabs, document]);
    setActiveTabId(document.id);
  }, [activateDocument, tabs]);

  const openDocumentPath = useCallback(async (path: string) => {
    try {
      const markdown = await platform.files.readMarkdown(path);
      const assetFolder = findAssetFolder(markdown);
      const storedFormat = await platform.files.readDocumentFormat(path, assetFolder);
      const parsedSidecar = parseDocumentSidecar(storedFormat?.content);
      const assets = collectDocumentImageAssets(markdown, parsedSidecar.sidecar.assets);
      addOpenedDocument(
        markdown,
        path,
        parseDocumentFormatSettings(parsedSidecar.sidecar.format),
        storedFormat?.assetFolder ?? assetFolder,
        parsedSidecar.sidecar.document,
        assets,
      );
      rememberRecentFile(path);
    } catch (error) {
      window.alert(`无法打开文稿：${String(error)}`);
    }
  }, [addOpenedDocument, rememberRecentFile]);

  const handleOpen = useCallback(async () => {
    const selectedPath = await platform.dialogs.openMarkdown({
      title: text.openMarkdownDocument,
      filter: { name: text.markdown, extensions: ["md", "markdown", "mdx"] },
    });
    if (!selectedPath) return;
    await openDocumentPath(selectedPath);
  }, [openDocumentPath, text.markdown, text.openMarkdownDocument]);

  const handleSave = useCallback(async () => {
    let targetPath = activeDocument.path;
    if (!targetPath) {
      const chosenPath = await platform.dialogs.saveMarkdown({
        title: text.saveMarkdownDocument,
        defaultPath: `${activeDocument.title || text.untitledDocument}.md`,
        filter: { name: text.markdown, extensions: ["md"] },
      });
      if (!chosenPath) return;
      targetPath = chosenPath.endsWith(".md") ? chosenPath : `${chosenPath}.md`;
    }
    try {
      const formatSettings = {
        ...activeDocument.formatSettings,
        documentFingerprint: documentContentFingerprint(activeDocument.content),
      };
      const sidecarContent = serializeDocumentSidecar({
        schemaVersion: HAKUROU_SCHEMA_VERSION,
        document: activeDocument.document,
        assets: activeDocument.assets,
        format: formatSettings,
      });
      await platform.files.writeMarkdown(targetPath, activeDocument.content);
      const storedFormat = await platform.files.writeDocumentFormat(targetPath, activeDocument.assetFolder, sidecarContent);
      const title = (targetPath.split(/[\\/]/).pop() ?? "未命名文稿").replace(/\.md$/i, "");
      setTabs((currentTabs) => currentTabs.map((tab) => (
        tab.id === activeDocument.id ? { ...tab, path: targetPath, title, initialContent: tab.content, assetFolder: storedFormat.assetFolder, formatSettings, isDirty: false } : tab
      )));
      rememberRecentFile(targetPath);
    } catch (error) {
      window.alert(String(error));
    }
  }, [activeDocument, rememberRecentFile, text.markdown, text.saveMarkdownDocument, text.untitledDocument]);

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
    if (tabs.some((tab) => tab.isDirty)) {
      setPendingClose({ kind: "app" });
      return;
    }
    exitApplication();
  }, [exitApplication, tabs]);

  const runEditCommand = useCallback((command: "undo" | "redo" | "cut" | "copy" | "paste") => {
    document.execCommand(command);
    setOpenMenu(null);
  }, []);

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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); void handleSave(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") { event.preventDefault(); createNewDocument(); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") { event.preventDefault(); void handleOpen(); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createNewDocument, handleOpen, handleSave]);

  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void platform.window.onCloseRequested(() => {
      if (tabsRef.current.some((tab) => tab.isDirty)) setPendingClose({ kind: "app" });
      else exitApplication();
    }).then((dispose) => { unlisten = dispose; });
    return () => unlisten?.();
  }, [exitApplication]);

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
    <button type="button" className={fontPresetIsActive(selectedFont, "elegant") ? "is-active" : ""} onClick={() => applyFont(scope, fontForPreset("elegant"))}>{text.elegant}</button>
    <button type="button" className={fontPresetIsActive(selectedFont, "modern") ? "is-active" : ""} onClick={() => applyFont(scope, fontForPreset("modern"))}>{text.modern}</button>
    <button type="button" className={fontPresetIsActive(selectedFont, "standard") ? "is-active" : ""} onClick={() => applyFont(scope, fontForPreset("standard"))}>{text.standard}</button>
    <button type="button" className={fontPresetIsActive(selectedFont, "custom") ? "is-active" : ""} onClick={() => openCustomFontDialog(scope)}>{text.custom}</button>
  </>;

  return (
    <main className="app-shell">
        <header className="app-menubar" onMouseDown={startWindowDragging} onDoubleClick={toggleWindowMaximize}>
          <nav className="app-menu-list" ref={menuListRef} aria-label={text.applicationMenu}>
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
                <button type="button" onClick={() => invokeMenuAction(() => setSidebarOpen((visible) => !visible))}>{text.documentPanel} <kbd>Ctrl Shift B</kbd></button>
              </div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "window" ? null : "window")}>{text.window}</button>
              {openMenu === "window" && <div className="app-menu-popup"><button type="button" onClick={() => invokeMenuAction(() => void handleWindowControl("minimize"))}>{text.minimize}</button></div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}>{text.help}</button>
              {openMenu === "help" && <div className="app-menu-popup"><button type="button" onClick={() => invokeMenuAction(() => window.alert(text.aboutMessage))}>{text.about}</button></div>}
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
        </div>

        <div className={`workspace-layout ${sidebarOpen ? "has-sidebar" : ""}`}>
          <aside className="app-rail" aria-label={text.workspaceNavigation}>
            <span className="rail-mark" title="HakurouPaper"><img src={hakurouAppIcon} alt="HakurouPaper" /></span>
            <button type="button" className={`rail-button ${sidebarOpen ? "is-active" : ""}`} onClick={() => setSidebarOpen((visible) => !visible)} title={text.outline} aria-label={text.outline}>▤</button>
          </aside>
          {sidebarOpen && <aside className="document-sidebar" aria-label={text.documentList}>
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
          <section className="editor-stage" aria-label={text.editingArea} style={documentFontStyle}>
              <WritingEditor
                key={activeDocument.id}
                documentId={activeDocument.id}
                initialContent={activeDocument.initialContent}
                onContentChange={updateDocument}
                documentPath={activeDocument.path}
                assetFolder={activeDocument.assetFolder}
                onAssetImported={updateDocumentAsset}
                formatSettings={activeDocument.formatSettings}
                onFormatChange={updateDocumentFormatSettings}
                onSelectionChange={updateSelectedText}
                text={text}
                tableStyle={effectiveDocumentDefaults.tableStyle}
                firstLineIndent={effectiveDocumentDefaults.firstLineIndent}
              />
          </section>
        </div>

        <footer className="statusbar">
          <span className="save-state"><i className={`save-state-dot ${activeDocument.isDirty ? "is-dirty" : "is-saved"}`} />{activeDocument.isDirty ? text.unsavedChanges : activeDocument.path ? text.savedLocally : text.localDraft}{selectedText && <span className="selection-count">{text.selectedCount(countWords(selectedText))}</span>}</span>
          <span>{text.documentStats(countWords(activeDocument.content), activeDocument.content.trim().length)}</span>
        </footer>
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
