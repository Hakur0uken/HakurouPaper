import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Editor, defaultValueCtx, rootCtx } from "@milkdown/core";
import { commonmark } from "@milkdown/preset-commonmark";
import { history } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { nord } from "@milkdown/theme-nord";
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

function createDocument(markdown = starterDocument, path: string | null = null, title = "未命名文稿"): DocumentTab {
  return {
    id: crypto.randomUUID(),
    title,
    path,
    content: markdown,
    initialContent: markdown,
    isDirty: false,
  };
}

function WritingEditor({ initialContent, onContentChange }: WritingEditorProps) {
  useEditor((root) => {
    const editor = Editor.make();

    editor
      .config(nord)
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, initialContent);
        ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => onContentChange(markdown));
      })
      .use(commonmark)
      .use(history)
      .use(listener);

    return editor;
  }, [initialContent, onContentChange]);

  return <Milkdown />;
}

function App() {
  const [tabs, setTabs] = useState<DocumentTab[]>(() => [createDocument()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0]!.id);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const activeDocument = useMemo(
    () => tabs.find((tab) => tab.id === activeTabId) ?? tabs[0]!,
    [activeTabId, tabs],
  );

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
    if (!activeDocument) return;
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        createNewDocument();
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault();
        void handleOpen();
      }
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

  return (
    <MilkdownProvider>
      <main className="app-shell">
        <header className="app-toolbar">
          <div className="toolbar-brand" aria-label="Hakurou">
            <span className="brand-mark">白</span>
            <span>Hakurou</span>
          </div>
          <nav className="toolbar-actions" aria-label="文稿操作">
            <button type="button" onClick={createNewDocument} title="新建文稿 (Ctrl+N)"><span>＋</span> 新建</button>
            <button type="button" onClick={() => void handleOpen()} title="打开文稿 (Ctrl+O)"><span>↗</span> 打开</button>
            <button type="button" onClick={() => void handleSave()} title="保存文稿 (Ctrl+S)"><span>⌘</span> 保存</button>
          </nav>
          <div className="toolbar-trailing">
            <button type="button" className="icon-button" onClick={() => setSidebarOpen((open) => !open)} title="切换文稿侧栏">☰</button>
          </div>
        </header>

        <div className="workspace-tabs" role="tablist" aria-label="已打开文稿">
          {tabs.map((tab) => (
            <div className={`workspace-tab-shell ${tab.id === activeTabId ? "is-active" : ""}`} key={tab.id}>
              <button
                type="button"
                className="workspace-tab"
                role="tab"
                aria-selected={tab.id === activeTabId}
                onClick={() => setActiveTabId(tab.id)}
              >
                <span className={`workspace-tab-dirty ${tab.isDirty ? "is-visible" : ""}`} aria-label={tab.isDirty ? "未保存" : undefined} />
                <span className="workspace-tab-label">{tab.title}</span>
              </button>
              <button type="button" className="workspace-tab-close" onClick={() => closeTab(tab.id)} aria-label={`关闭 ${tab.title}`}>×</button>
            </div>
          ))}
          <button type="button" className="new-tab-button" onClick={createNewDocument} title="新建文稿">＋</button>
        </div>

        <div className={`workspace-layout ${sidebarOpen ? "has-sidebar" : ""}`}>
          {sidebarOpen && (
            <aside className="document-sidebar" aria-label="文稿列表">
              <div className="sidebar-heading"><span>文稿</span><button type="button" onClick={createNewDocument} aria-label="新建文稿">＋</button></div>
              <div className="sidebar-list">
                {tabs.map((tab) => (
                  <button
                    type="button"
                    key={tab.id}
                    className={`sidebar-document ${tab.id === activeTabId ? "is-active" : ""}`}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    <span className={`sidebar-document-dot ${tab.isDirty ? "is-dirty" : ""}`} />
                    <span>{tab.title}</span>
                  </button>
                ))}
              </div>
            </aside>
          )}
          <section className="editor-stage" aria-label="文档编辑区">
            <WritingEditor key={activeDocument.id} initialContent={activeDocument.initialContent} onContentChange={updateActiveDocument} />
          </section>
        </div>

        <footer className="statusbar">
          <span>{activeDocument.isDirty ? "未保存修改" : activeDocument.path ? "已保存在本地" : "本地草稿"}</span>
          <span>{activeDocument.content.trim().length} 字符</span>
        </footer>
      </main>
    </MilkdownProvider>
  );
}

export default App;
