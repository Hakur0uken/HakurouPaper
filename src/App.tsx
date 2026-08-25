import { useCallback, useEffect, useState } from "react";
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

## 写作提示

选中文本后可使用浮动格式工具；也可以直接使用常见快捷键，例如 **Ctrl+B** 加粗。`;

type WritingEditorProps = {
  initialContent: string;
  onContentChange: (markdown: string) => void;
};

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
  const [content, setContent] = useState(starterDocument);
  const [editorInitialContent, setEditorInitialContent] = useState(starterDocument);
  const [editorKey, setEditorKey] = useState(0);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [documentTitle, setDocumentTitle] = useState("未命名文稿");
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState("本地草稿");

  const updateContent = useCallback((markdown: string) => {
    setContent(markdown);
    setIsDirty(true);
    setSaveState("未保存");
  }, []);

  const loadDocument = useCallback((markdown: string, path: string | null, title: string) => {
    setContent(markdown);
    setEditorInitialContent(markdown);
    setFilePath(path);
    setDocumentTitle(title);
    setIsDirty(false);
    setSaveState(path ? "已保存在本地" : "本地草稿");
    setEditorKey((key) => key + 1);
  }, []);

  const handleNew = useCallback(() => {
    if (isDirty && !window.confirm("当前文稿有未保存的修改。仍要新建吗？")) return;
    loadDocument("# 未命名文稿\n\n", null, "未命名文稿");
  }, [isDirty, loadDocument]);

  const handleOpen = useCallback(async () => {
    if (isDirty && !window.confirm("当前文稿有未保存的修改。仍要打开其他文件吗？")) return;
    const selectedPath = await open({
      title: "打开 Markdown 文稿",
      multiple: false,
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx"] }],
    });
    if (!selectedPath || Array.isArray(selectedPath)) return;

    try {
      const markdown = await invoke<string>("read_markdown", { path: selectedPath });
      const filename = selectedPath.split(/[\\/]/).pop() ?? "未命名文稿";
      loadDocument(markdown, selectedPath, filename.replace(/\.(md|markdown|mdx)$/i, ""));
    } catch (error) {
      window.alert(String(error));
    }
  }, [isDirty, loadDocument]);

  const handleSave = useCallback(async () => {
    let targetPath = filePath;
    if (!targetPath) {
      const chosenPath = await save({
        title: "保存 Markdown 文稿",
        defaultPath: `${documentTitle || "未命名文稿"}.md`,
        filters: [{ name: "Markdown", extensions: ["md"] }],
      });
      if (!chosenPath) return;
      targetPath = chosenPath.endsWith(".md") ? chosenPath : `${chosenPath}.md`;
    }

    try {
      setSaveState("保存中…");
      await invoke("write_markdown", { path: targetPath, content });
      setFilePath(targetPath);
      setDocumentTitle((targetPath.split(/[\\/]/).pop() ?? "未命名文稿").replace(/\.md$/i, ""));
      setIsDirty(false);
      setSaveState("已保存在本地");
    } catch (error) {
      setSaveState("保存失败");
      window.alert(String(error));
    }
  }, [content, documentTitle, filePath]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleSave]);

  return (
    <MilkdownProvider>
      <main className="app-shell">
        <header className="titlebar">
          <div className="brand" aria-label="Hakurou">
            <span className="brand-mark">白</span>
            <span>Hakurou</span>
          </div>
          <div className="document-title">{documentTitle} <span>· {isDirty ? "未保存" : saveState}</span></div>
          <div className="document-actions">
            <button type="button" onClick={handleNew}>新建</button>
            <button type="button" onClick={() => void handleOpen()}>打开</button>
            <button type="button" className="primary-action" onClick={() => void handleSave()}>保存</button>
          </div>
        </header>
        <section className="editor-stage" aria-label="文档编辑区">
          <WritingEditor key={editorKey} initialContent={editorInitialContent} onContentChange={updateContent} />
        </section>
        <footer className="statusbar">
          <span>Markdown · 本地优先</span>
          <span><kbd>Ctrl</kbd> <kbd>S</kbd> 保存　<kbd>Ctrl</kbd> <kbd>Z</kbd> 撤销</span>
        </footer>
      </main>
    </MilkdownProvider>
  );
}

export default App;
