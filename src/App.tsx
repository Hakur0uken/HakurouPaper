import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Crepe } from "@milkdown/crepe";
import "katex/dist/katex.min.css";
import "./App.css";
import "./hakurou.css";

const starterDocument = `# 未命名文稿

从这里开始写作。Hakurou 会将你的内容保存为标准 Markdown 文件，让它能在 Typora、VS Code 和任何支持 Markdown 的工具中继续使用。
`;

type DocumentTab = {
  id: string;
  title: string;
  path: string | null;
  content: string;
  initialContent: string;
  isDirty: boolean;
};

type WritingEditorProps = {
  initialContent: string;
  onContentChange: (markdown: string) => void;
};

type DocumentHeading = {
  level: number;
  title: string;
};

function createDocument(markdown = starterDocument, path: string | null = null, title = "未命名文稿"): DocumentTab {
  return { id: crypto.randomUUID(), title, path, content: markdown, initialContent: markdown, isDirty: false };
}

function WritingEditor({ initialContent, onContentChange }: WritingEditorProps) {
  const editorRootRef = useRef<HTMLDivElement>(null);
  const initialContentRef = useRef(initialContent);
  const onContentChangeRef = useRef(onContentChange);
  onContentChangeRef.current = onContentChange;

  useEffect(() => {
    if (!editorRootRef.current) return;
    const editor = new Crepe({
      root: editorRootRef.current,
      defaultValue: initialContentRef.current,
      features: {
        [Crepe.Feature.CodeMirror]: true,
        [Crepe.Feature.Latex]: true,
        [Crepe.Feature.Cursor]: false,
        [Crepe.Feature.ListItem]: false,
        [Crepe.Feature.LinkTooltip]: false,
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.Toolbar]: false,
        [Crepe.Feature.Placeholder]: false,
        [Crepe.Feature.Table]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.AI]: false,
      },
      featureConfigs: {
        [Crepe.Feature.Latex]: { katexOptions: { throwOnError: false } },
      },
    });
    editor.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => onContentChangeRef.current(markdown));
    });
    void editor.create();
    return () => { void editor.destroy(); };
  }, []);

  return <div className="editor-root" ref={editorRootRef} />;
}

function App() {
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [createDocument()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]!.id);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const menuListRef = useRef<HTMLElement>(null);

  const activeDocument = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!,
    [activeTabId, tabs],
  );

  const documentHeadings = useMemo<DocumentHeading[]>(() => (
    [...activeDocument.content.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((match) => ({
      level: match[1]!.length,
      title: match[2]!.trim(),
    }))
  ), [activeDocument.content]);

  const updateActiveDocument = useCallback((markdown: string) => {
    setTabs((currentTabs) => currentTabs.map((tab) => (
      tab.id === activeTabId ? { ...tab, content: markdown, isDirty: true } : tab
    )));
  }, [activeTabId]);

  const createNewDocument = useCallback(() => {
    const document = createDocument();
    setTabs((currentTabs) => [...currentTabs, document]);
    setActiveTabId(document.id);
  }, []);

  const addOpenedDocument = useCallback((markdown: string, path: string) => {
    const existingDocument = tabs.find((tab) => tab.path === path);
    if (existingDocument) {
      setActiveTabId(existingDocument.id);
      return;
    }
    const filename = path.split(/[\\/]/).pop() ?? "未命名文稿";
    const document = createDocument(markdown, path, filename.replace(/\.(md|markdown|mdx)$/i, ""));
    setTabs((currentTabs) => [...currentTabs, document]);
    setActiveTabId(document.id);
  }, [tabs]);

  const handleOpen = useCallback(async () => {
    const selectedPaths = await open({
      title: "打开 Markdown 文稿",
      multiple: true,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
    });
    if (!selectedPaths) return;
    for (const path of Array.isArray(selectedPaths) ? selectedPaths : [selectedPaths]) {
      try {
        const markdown = await invoke<string>("read_markdown", { path });
        addOpenedDocument(markdown, path);
      } catch (error) {
        window.alert(String(error));
      }
    }
  }, [addOpenedDocument]);

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
    } catch (error) {
      window.alert(String(error));
    }
  }, [activeDocument]);

  const closeTab = useCallback((tabId: string) => {
    const tab = tabs.find((item) => item.id === tabId);
    if (!tab) return;
    if (tab.isDirty && !window.confirm(`“${tab.title}”尚未保存。确定放弃修改并关闭吗？`)) return;
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
    if (action === "close") await appWindow.close();
  }, []);

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
    const warnBeforeClosing = (event: BeforeUnloadEvent) => {
      if (!tabs.some((tab) => tab.isDirty)) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeClosing);
    return () => window.removeEventListener("beforeunload", warnBeforeClosing);
  }, [tabs]);

  useEffect(() => {
    const closeMenuOnOutsidePress = (event: PointerEvent) => {
      if (!menuListRef.current?.contains(event.target as Node)) setOpenMenu(null);
    };
    window.addEventListener("pointerdown", closeMenuOnOutsidePress);
    return () => window.removeEventListener("pointerdown", closeMenuOnOutsidePress);
  }, []);

  const invokeMenuAction = (action: () => void) => {
    action();
    setOpenMenu(null);
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
              {openMenu === "help" && <div className="app-menu-popup"><button type="button" onClick={() => invokeMenuAction(() => window.alert("Hakurou\nLocal-first Markdown writing workspace."))}>About Hakurou</button></div>}
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
                <button type="button" className="workspace-tab" role="tab" aria-selected={tab.id === activeTabId} onClick={() => setActiveTabId(tab.id)}>
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
            <span className="rail-mark" title="Hakurou">H</span>
            <button type="button" className={`rail-button ${sidebarOpen ? "is-active" : ""}`} onClick={() => setSidebarOpen((visible) => !visible)} title="文稿">▤</button>
          </aside>
          {sidebarOpen && <aside className="document-sidebar" aria-label="文稿列表">
            {documentHeadings.length > 0 && <>
              <div className="sidebar-heading sidebar-outline-heading"><span>目录</span></div>
              <div className="sidebar-outline-list">
                {documentHeadings.map((heading, index) => (
                  <button
                    type="button"
                    className={`sidebar-outline-item level-${Math.min(heading.level, 3)}`}
                    key={`${heading.title}-${index}`}
                    onClick={() => jumpToHeading(index)}
                    title={heading.title}
                  >
                    {heading.title}
                  </button>
                ))}
              </div>
            </>}
          </aside>}
          <section className="editor-stage" aria-label="文档编辑区">
            <WritingEditor key={activeDocument.id} initialContent={activeDocument.content} onContentChange={updateActiveDocument} />
          </section>
        </div>

        <footer className="statusbar">
          <span>{activeDocument.isDirty ? "未保存修改" : activeDocument.path ? "已保存在本地" : "本地草稿"}</span>
          <span>{activeDocument.content.trim().length} 字符</span>
        </footer>
      </main>
  );
}

export default App;
