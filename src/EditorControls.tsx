import { useEffect, useState } from "react";
import { setBlockType, toggleMark } from "@milkdown/prose/commands";
import { liftListItem, wrapInList } from "@milkdown/prose/schema-list";
import { TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";

type Position = { x: number; y: number };
type BlockAction = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bullet" | "ordered" | "code";
type BlockTarget = Position & { position: number; kind: BlockAction };
type EditorControlsProps = { view: EditorView | null; onSelectionChange: (text: string | null) => void };

function setSelectionAtBlock(view: EditorView, position: number) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
}

export function EditorControls({ view, onSelectionChange }: EditorControlsProps) {
  const [block, setBlock] = useState<BlockTarget | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<Position | null>(null);

  useEffect(() => {
    if (!view) return;
    const editor = view.dom;
    const blockSelector = "p, h1, h2, h3, h4, h5, h6, blockquote, pre, li";

    const selectionTouchesImage = () => {
      let touchesImage = false;
      const { from, to } = view.state.selection;
      view.state.doc.nodesBetween(from, to, (node) => {
        if (node.type.name === "image") touchesImage = true;
      });
      return touchesImage;
    };
    const updateImageRangeStyle = () => {
      const range = window.getSelection()?.rangeCount ? window.getSelection()?.getRangeAt(0) : null;
      editor.querySelectorAll("img").forEach((image) => {
        image.classList.toggle("is-range-selected", Boolean(range?.intersectsNode(image)));
      });
    };
    const updateSelectionSummary = () => {
      const selection = view.state.selection;
      if (selection.empty || selectionTouchesImage()) {
        onSelectionChange(null);
        return;
      }
      onSelectionChange(view.state.doc.textBetween(selection.from, selection.to, " ").trim() || null);
    };

    const updateBlock = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return;
      if (target.closest("img")) {
        setBlock(null);
        return;
      }
      const element = target.closest(blockSelector);
      if (!element || !editor.contains(element)) return;
      const rect = element.getBoundingClientRect();
      const position = view.posAtDOM(element, 0);
      const tag = element.tagName.toLowerCase();
      const kind: BlockAction = tag === "h1" ? "heading-1"
        : tag === "h2" ? "heading-2"
          : tag === "h3" ? "heading-3"
            : tag === "pre" ? "code"
                : element.closest("ol") ? "ordered"
                  : element.closest("ul") ? "bullet"
                    : "paragraph";
      setBlock({ position, kind, x: Math.max(8, rect.left - 34), y: rect.top + 4 });
    };
    const updateSelection = () => {
      const selection = view.state.selection;
      if (selection.empty || !view.hasFocus() || selectionTouchesImage()) {
        setSelectionMenu(null);
        return;
      }
      const start = view.coordsAtPos(selection.from);
      const end = view.coordsAtPos(selection.to);
      setSelectionMenu({ x: Math.max(8, (start.left + end.right) / 2), y: Math.max(8, Math.min(start.top, end.top) - 42) });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!view.state.selection.empty) return;
      updateBlock(event.target);
    };
    const onPointerDown = () => {
      setSelectionMenu(null);
      setBlock(null);
      setBlockMenuOpen(false);
    };
    const onPointerUp = () => requestAnimationFrame(() => {
      updateImageRangeStyle();
      updateSelectionSummary();
      updateSelection();
    });
    const onNativeSelectionChange = () => {
      updateImageRangeStyle();
      updateSelectionSummary();
    };
    const onDocumentPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || !target.closest(".block-menu, .block-handle, .selection-toolbar")) {
        setBlockMenuOpen(false);
        if (!(target instanceof Node) || !editor.contains(target)) setSelectionMenu(null);
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("img")) return;
      updateBlock(event.target);
      setBlockMenuOpen(true);
      event.preventDefault();
    };
    editor.addEventListener("pointermove", onPointerMove);
    editor.addEventListener("pointerdown", onPointerDown);
    editor.addEventListener("pointerup", onPointerUp);
    editor.addEventListener("contextmenu", onContextMenu);
    editor.addEventListener("keyup", updateSelection);
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("selectionchange", onNativeSelectionChange);
    return () => {
      editor.querySelectorAll("img.is-range-selected").forEach((image) => image.classList.remove("is-range-selected"));
      editor.removeEventListener("pointermove", onPointerMove);
      editor.removeEventListener("pointerdown", onPointerDown);
      editor.removeEventListener("pointerup", onPointerUp);
      editor.removeEventListener("contextmenu", onContextMenu);
      editor.removeEventListener("keyup", updateSelection);
      document.removeEventListener("pointerdown", onDocumentPointerDown);
      document.removeEventListener("selectionchange", onNativeSelectionChange);
      onSelectionChange(null);
    };
  }, [onSelectionChange, view]);

  const blockLabel = (() => {
    if (!block) return "T";
    if (block.kind.startsWith("heading")) return `H${block.kind.slice(-1)}`;
    if (block.kind === "code") return "</>";
    if (block.kind === "bullet") return "•";
    if (block.kind === "ordered") return "1.";
    return "T";
  })();

  const runBlockCommand = (action: BlockAction) => {
    if (!view || !block) return;
    setSelectionAtBlock(view, block.position);
    const { nodes } = view.state.schema;
    if (action === block.kind) {
      if (action === "bullet" || action === "ordered") liftListItem(nodes.list_item!)(view.state, view.dispatch, view);
      else if (action !== "paragraph") setBlockType(nodes.paragraph!)(view.state, view.dispatch, view);
      view.focus();
      setBlockMenuOpen(false);
      return;
    }
    if (action === "paragraph") setBlockType(nodes.paragraph!)(view.state, view.dispatch, view);
    if (action.startsWith("heading")) setBlockType(nodes.heading!, { level: Number(action.slice(-1)) })(view.state, view.dispatch, view);
    if (action === "bullet") wrapInList(nodes.bullet_list!)(view.state, view.dispatch, view);
    if (action === "ordered") wrapInList(nodes.ordered_list!)(view.state, view.dispatch, view);
    if (action === "code") setBlockType(nodes.code_block!)(view.state, view.dispatch, view);
    view.focus();
    setBlockMenuOpen(false);
  };

  const runMarkCommand = (mark: "strong" | "em" | "code" | "underline" | "strike") => {
    if (!view) return;
    const target = mark === "code"
      ? view.state.schema.marks.inlineCode
      : view.state.schema.marks[mark === "strike" ? "strike_through" : mark === "em" ? "emphasis" : mark];
    if (target) toggleMark(target)(view.state, view.dispatch, view);
    view.focus();
    setSelectionMenu(null);
  };

  const isMarkActive = (mark: "strong" | "em" | "code" | "strike") => {
    if (!view) return false;
    const target = mark === "code"
      ? view.state.schema.marks.inlineCode
      : view.state.schema.marks[mark === "strike" ? "strike_through" : mark === "em" ? "emphasis" : mark];
    return Boolean(target && (view.state.selection.$from.marks().some((item) => item.type === target)
      || view.state.doc.rangeHasMark(view.state.selection.from, view.state.selection.to, target)));
  };

  return <>
    {block && !selectionMenu && <button
      type="button"
      className="block-handle"
      style={{ left: block.x, top: block.y }}
      title="块菜单"
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setBlockMenuOpen((open) => !open)}
      aria-label="块菜单"
    ><span className="block-handle-label">{blockLabel}</span><span>⠿</span></button>}
    {block && blockMenuOpen && <div className="block-menu" style={{ left: Math.max(8, block.x - 208), top: block.y }} onMouseDown={(event) => event.preventDefault()}>
      <div className="block-menu-row">
        <button className={block.kind === "paragraph" ? "is-active" : ""} type="button" title="正文｜Markdown：普通段落" onClick={() => runBlockCommand("paragraph")}>正文</button>
        <button className={block.kind === "heading-1" ? "is-active" : ""} type="button" title="一级标题｜Markdown：# 标题｜再次点击还原正文" onClick={() => runBlockCommand("heading-1")}>H1</button>
        <button className={block.kind === "heading-2" ? "is-active" : ""} type="button" title="二级标题｜Markdown：## 标题｜再次点击还原正文" onClick={() => runBlockCommand("heading-2")}>H2</button>
        <button className={block.kind === "heading-3" ? "is-active" : ""} type="button" title="三级标题｜Markdown：### 标题｜再次点击还原正文" onClick={() => runBlockCommand("heading-3")}>H3</button>
      </div>
      <div className="block-menu-row">
        <button className={block.kind === "bullet" ? "is-active" : ""} type="button" title="项目符号列表｜Markdown：- 内容｜再次点击还原正文" onClick={() => runBlockCommand("bullet")}>• 列表</button>
        <button className={block.kind === "ordered" ? "is-active" : ""} type="button" title="编号列表｜Markdown：1. 内容｜再次点击还原正文" onClick={() => runBlockCommand("ordered")}>1. 列表</button>
      </div>
      <div className="block-menu-row">
        <button className={block.kind === "code" ? "is-active" : ""} type="button" title="代码块｜Markdown：```｜再次点击还原正文" onClick={() => runBlockCommand("code")}>‹/› 代码</button>
      </div>
    </div>}
    {selectionMenu && <div className="selection-toolbar" style={{ left: selectionMenu.x, top: selectionMenu.y }} onMouseDown={(event) => event.preventDefault()}>
      <button className={isMarkActive("strong") ? "is-active" : ""} type="button" title="加粗｜Ctrl+B｜Markdown：**文字**" onClick={() => runMarkCommand("strong")}><b>B</b></button>
      <button className={isMarkActive("em") ? "is-active" : ""} type="button" title="斜体｜Ctrl+I｜Markdown：*文字*" onClick={() => runMarkCommand("em")}><i>I</i></button>
      <button className={isMarkActive("strike") ? "is-active" : ""} type="button" title="删除线｜Markdown：~~文字~~" onClick={() => runMarkCommand("strike")}><s>S</s></button>
      <span className="selection-toolbar-divider" />
      <button type="button" className="selection-align-button" title="对齐方式｜当前 Markdown 标准不保存段落对齐" aria-label="对齐方式">☰</button>
      <button className={isMarkActive("code") ? "is-active" : ""} type="button" title="行内代码｜Markdown：`代码`" onClick={() => runMarkCommand("code")}>‹/›</button>
    </div>}
  </>;
}
