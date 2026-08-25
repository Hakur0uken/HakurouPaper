import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/core";
import { $prose } from "@milkdown/utils";
import { Plugin } from "@milkdown/prose/state";
import { commonmark } from "@milkdown/preset-commonmark";
import { gfm } from "@milkdown/preset-gfm";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { nord } from "@milkdown/theme-nord";
import { FormulaLab } from "./FormulaLab";
import { EditorControls } from "./EditorControls";
import { createImageAssetPlugins, formulaPlugins } from "./math";
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
};

type WritingEditorProps = {
  documentId: string;
  initialContent: string;
  onContentChange: (documentId: string, markdown: string) => void;
  documentPath: string | null;
  assetFolder: string | null;
  onAssetFolderChange: (documentId: string, folder: string) => void;
  onSelectionChange: (text: string | null) => void;
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

const recentFilesStorageKey = "hakurou.recent-files";

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

function createDocument(markdown = starterDocument, path: string | null = null, title = "未命名文稿"): DocumentTab {
  return { id: crypto.randomUUID(), title, path, content: markdown, initialContent: markdown, isDirty: false, assetFolder: findAssetFolder(markdown) };
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

function WritingEditor({ documentId, initialContent, onContentChange, documentPath, assetFolder, onAssetFolderChange, onSelectionChange }: WritingEditorProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const [editorView, setEditorView] = useState<import("@milkdown/prose/view").EditorView | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const editorHost = document.createElement("div");
    mount.replaceChildren(editorHost);
    let disposed = false;
    const editorControlsBridge = $prose(() => new Plugin({
      view: (proseView) => {
        if (!disposed) setEditorView(proseView);
        return {
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
      .use(history)
      .use(listener)
      .use(formulaPlugins)
      .use(createImageAssetPlugins(documentPath, assetFolder, (folder) => onAssetFolderChange(documentId, folder)))
      .use(editorControlsBridge);
    void editor.create().catch(console.error);
    return () => {
      disposed = true;
      setEditorView(null);
      void editor.destroy().catch(console.error);
      if (mount.contains(editorHost)) mount.replaceChildren();
    };
  }, [assetFolder, documentId, documentPath, initialContent, onAssetFolderChange, onContentChange]);

  return <div className="writing-editor-root"><div ref={mountRef} data-milkdown-root="true" /><EditorControls view={editorView} onSelectionChange={onSelectionChange} /></div>;
}

function App() {
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [createDocument()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]!.id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workspaceView, setWorkspaceView] = useState<"writing" | "formula-lab">("writing");
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [collapsedHeadings, setCollapsedHeadings] = useState<Record<string, number[]>>({});
  const [pendingClose, setPendingClose] = useState<PendingClose>(null);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(readRecentFiles);
  const [recentFilesMenuOpen, setRecentFilesMenuOpen] = useState(false);
  const menuListRef = useRef<HTMLElement>(null);
  const tabsRef = useRef(tabs);
  const recentFilesMenuTimerRef = useRef<number | null>(null);

  const activeDocument = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!,
    [activeTabId, tabs],
  );

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

  const updateDocumentAssetFolder = useCallback((documentId: string, folder: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === documentId ? { ...tab, assetFolder: folder } : tab
    )));
  }, []);

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

  const addOpenedDocument = useCallback((markdown: string, path: string) => {
    const existingDocument = tabs.find((tab) => tab.path === path);
    if (existingDocument) {
      activateDocument(existingDocument.id);
      return;
    }
    const filename = filenameFromPath(path);
    const document = createDocument(markdown, path, filename.replace(/\.(md|markdown|mdx)$/i, ""));
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
      const markdown = await invoke<string>("read_markdown", { path });
      addOpenedDocument(markdown, path);
      rememberRecentFile(path);
    } catch (error) {
      window.alert(`无法打开文稿：${String(error)}`);
    }
  }, [addOpenedDocument, rememberRecentFile]);

  const handleOpen = useCallback(async () => {
    const selectedPaths = await open({
      title: "打开 Markdown 文稿",
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
    });
    if (!selectedPaths) return;
    await openDocumentPath(selectedPaths);
  }, [openDocumentPath]);

  const handleSave = useCallback(async () => {
    let targetPath = activeDocument.path;
    if (!targetPath) {
      const chosenPath = await save({
        title: "保存 Markdown 文稿",
        defaultPath: `${activeDocument.title || "未命名文稿"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!chosenPath) return;
      targetPath = chosenPath.endsWith(".md") ? chosenPath : `${chosenPath}.md`;
    }
    try {
      await invoke("write_markdown", { path: targetPath, content: activeDocument.content });
      const title = (targetPath.split(/[\\/]/).pop() ?? "未命名文稿").replace(/\.md$/i, "");
      setTabs((currentTabs) => currentTabs.map((tab) => (
        tab.id === activeDocument.id ? { ...tab, path: targetPath, title, isDirty: false } : tab
      )));
      rememberRecentFile(targetPath);
    } catch (error) {
      window.alert(String(error));
    }
  }, [activeDocument, rememberRecentFile]);

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
    void invoke("close_application");
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
    const appWindow = getCurrentWindow();
    if (action === "minimize") await appWindow.minimize();
    if (action === "maximize") {
      if (await appWindow.isMaximized()) await appWindow.unmaximize();
      else await appWindow.maximize();
    }
    if (action === "close") requestAppClose();
  }, [requestAppClose]);

  const startWindowDragging = useCallback((event: React.MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (event.button !== 0 || target.closest("button, .app-menu-popup")) return;
    void getCurrentWindow().startDragging();
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
    void getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
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
      }
    };
    window.addEventListener("pointerdown", closeMenuOnOutsidePress);
    return () => {
      window.removeEventListener("pointerdown", closeMenuOnOutsidePress);
      if (recentFilesMenuTimerRef.current !== null) window.clearTimeout(recentFilesMenuTimerRef.current);
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

  const openRecentFilesMenu = useCallback(() => {
    if (recentFilesMenuOpen || recentFilesMenuTimerRef.current !== null) return;
    recentFilesMenuTimerRef.current = window.setTimeout(() => {
      setRecentFilesMenuOpen(true);
      recentFilesMenuTimerRef.current = null;
    }, 250);
  }, [recentFilesMenuOpen]);

  const invokeMenuAction = (action: () => void) => {
    action();
    setOpenMenu(null);
    setRecentFilesMenuOpen(false);
  };

  return (
    <main className="app-shell">
        <header className="app-menubar" onMouseDown={startWindowDragging} onDoubleClick={toggleWindowMaximize}>
          <nav className="app-menu-list" ref={menuListRef} aria-label="应用菜单">
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}>File</button>
              {openMenu === "file" && <div className="app-menu-popup">
                <button type="button" onClick={() => invokeMenuAction(createNewDocument)}>New <kbd>Ctrl N</kbd></button>
                <button type="button" onClick={() => invokeMenuAction(() => void handleOpen())}>Open… <kbd>Ctrl O</kbd></button>
                <div className={`app-menu-submenu ${recentFilesMenuOpen ? "is-open" : ""}`}>
                  <button type="button" className="app-menu-submenu-trigger" aria-expanded={recentFilesMenuOpen} onMouseEnter={openRecentFilesMenu} onClick={() => setRecentFilesMenuOpen(true)}>Recent Files <span aria-hidden="true">›</span></button>
                  <div className="app-menu-submenu-popup" aria-label="最近打开的文件">
                    {recentFiles.length > 0 ? recentFiles.map((file) => (
                      <button key={file.path} type="button" title={file.path} onClick={() => invokeMenuAction(() => void openDocumentPath(file.path))}>
                        <span className="recent-file-label">{file.title}</span>
                      </button>
                    )) : <span className="app-menu-empty">暂无最近打开的文稿</span>}
                  </div>
                </div>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => invokeMenuAction(() => void handleSave())}>Save <kbd>Ctrl S</kbd></button>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => invokeMenuAction(() => closeTab(activeTabId))}>Close Document <kbd>Ctrl W</kbd></button>
              </div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}>Edit</button>
              {openMenu === "edit" && <div className="app-menu-popup">
                <button type="button" onClick={() => runEditCommand("undo")}>Undo <kbd>Ctrl Z</kbd></button>
                <button type="button" onClick={() => runEditCommand("redo")}>Redo <kbd>Ctrl Y</kbd></button>
                <span className="app-menu-separator" />
                <button type="button" onClick={() => runEditCommand("cut")}>Cut <kbd>Ctrl X</kbd></button>
                <button type="button" onClick={() => runEditCommand("copy")}>Copy <kbd>Ctrl C</kbd></button>
                <button type="button" onClick={() => runEditCommand("paste")}>Paste <kbd>Ctrl V</kbd></button>
              </div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "view" ? null : "view")}>View</button>
              {openMenu === "view" && <div className="app-menu-popup"><button type="button" onClick={() => invokeMenuAction(() => setSidebarOpen((visible) => !visible))}>Document Panel <kbd>Ctrl Shift B</kbd></button></div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "window" ? null : "window")}>Window</button>
              {openMenu === "window" && <div className="app-menu-popup"><button type="button" onClick={() => invokeMenuAction(() => void handleWindowControl("minimize"))}>Minimize</button></div>}
            </div>
            <div className="app-menu">
              <button type="button" onClick={() => setOpenMenu(openMenu === "help" ? null : "help")}>Help</button>
              {openMenu === "help" && <div className="app-menu-popup"><button type="button" onClick={() => invokeMenuAction(() => window.alert("HakurouPaper\nLocal-first Markdown writing workspace."))}>About HakurouPaper</button></div>}
            </div>
          </nav>
          <div className="window-controls">
            <button type="button" onClick={() => void handleWindowControl("minimize")} aria-label="最小化">—</button>
            <button type="button" onClick={() => void handleWindowControl("maximize")} aria-label="最大化">□</button>
            <button type="button" className="window-close" onClick={() => void handleWindowControl("close")} aria-label="关闭">×</button>
          </div>
        </header>

        <div className="workspace-tabs" role="tablist" aria-label="已打开文稿">
          <div className="tab-rail-spacer" aria-hidden="true" />
          <div className="workspace-tab-scroll">
            {tabs.map((tab) => (
              <div className={`workspace-tab-shell ${tab.id === activeTabId ? "is-active" : ""}`} key={tab.id}>
                <button type="button" className="workspace-tab" role="tab" aria-selected={tab.id === activeTabId} onClick={() => activateDocument(tab.id)}>
                  <span className={`workspace-tab-dirty ${tab.isDirty ? "is-visible" : ""}`} aria-label={tab.isDirty ? "未保存" : undefined} />
                  <span className="workspace-tab-label">{tab.title}</span>
                </button>
                <button type="button" className="workspace-tab-close" onClick={() => closeTab(tab.id)} aria-label={`关闭 ${tab.title}`}>×</button>
              </div>
            ))}
          </div>
        </div>

        <div className={`workspace-layout ${sidebarOpen ? "has-sidebar" : ""}`}>
          <aside className="app-rail" aria-label="工作区导航">
            <span className="rail-mark" title="HakurouPaper"><img src={hakurouAppIcon} alt="HakurouPaper" /></span>
            <button type="button" className={`rail-button ${workspaceView === "writing" && sidebarOpen ? "is-active" : ""}`} onClick={() => { setWorkspaceView("writing"); setSidebarOpen((visible) => workspaceView === "writing" ? !visible : true); }} title="目录">▤</button>
            <button type="button" className={`rail-button formula-rail-button ${workspaceView === "formula-lab" ? "is-active" : ""}`} onClick={() => setWorkspaceView("formula-lab")} title="公式实验台">∑</button>
          </aside>
          {sidebarOpen && <aside className="document-sidebar" aria-label="文稿列表">
            {documentHeadings.length > 0 && <>
              <div className="sidebar-heading sidebar-outline-heading"><span>目录</span></div>
              <div className="sidebar-outline-list">
                {documentHeadings.map((heading, index) => isHeadingVisibleInOutline(index) && (
                  <div className={`sidebar-outline-row level-${Math.min(heading.level, 3)}`} key={`${heading.title}-${index}`}>
                    {heading.canCollapse && <button
                      type="button"
                      className="sidebar-outline-toggle"
                      onClick={() => toggleHeadingCollapse(index)}
                      title={activeCollapsedHeadings.includes(index) ? "展开此标题下内容" : "收起此标题下内容"}
                      aria-label={activeCollapsedHeadings.includes(index) ? "展开此标题下内容" : "收起此标题下内容"}
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
          <section className="editor-stage" aria-label="文档编辑区">
              <WritingEditor
                key={activeDocument.id}
                documentId={activeDocument.id}
                initialContent={activeDocument.initialContent}
                onContentChange={updateDocument}
                documentPath={activeDocument.path}
                assetFolder={activeDocument.assetFolder}
                onAssetFolderChange={updateDocumentAssetFolder}
                onSelectionChange={updateSelectedText}
              />
            {workspaceView === "formula-lab" && (
              <div className="formula-lab-overlay"><FormulaLab onReturn={() => setWorkspaceView("writing")} /></div>
            )}
          </section>
        </div>

        <footer className="statusbar">
          <span className="save-state"><i className={`save-state-dot ${activeDocument.isDirty ? "is-dirty" : "is-saved"}`} />{activeDocument.isDirty ? "未保存修改" : activeDocument.path ? "已保存在本地" : "本地草稿"}{selectedText && <span className="selection-count">· 已选 {countWords(selectedText)} 字</span>}</span>
          <span>{countWords(activeDocument.content)} 字 · {activeDocument.content.trim().length} 字符</span>
        </footer>
        {pendingClose && <div className="close-confirm-backdrop" role="presentation">
          <section className="close-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="close-confirm-title">
            <h2 id="close-confirm-title">{pendingClose.kind === "app" ? "存在未保存文稿" : "文稿尚未保存"}</h2>
            <p>{pendingClose.kind === "app" ? "存在未保存的修改。确定不保存并关闭 HakurouPaper 吗？" : `“${tabs.find((tab) => tab.id === pendingClose.tabId)?.title ?? "未命名文稿"}”的修改尚未保存。确定不保存并关闭此文稿吗？`}</p>
            <div className="close-confirm-actions">
              <button type="button" onClick={() => setPendingClose(null)}>返回编辑</button>
              <button type="button" className="is-danger" onClick={() => {
                if (pendingClose.kind === "tab") discardAndCloseTab(pendingClose.tabId);
                else exitApplication();
                setPendingClose(null);
              }}>不保存并关闭</button>
            </div>
          </section>
        </div>}
    </main>
  );
}

export default App;
