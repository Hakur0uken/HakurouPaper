import { useEffect, useRef, useState } from "react";
import { setBlockType, toggleMark } from "@milkdown/prose/commands";
import { liftListItem, wrapInList } from "@milkdown/prose/schema-list";
import { NodeSelection, Selection, TextSelection } from "@milkdown/prose/state";
import type { EditorView } from "@milkdown/prose/view";
import { getTableDecoration, setTableDecoration, tableDecorationPluginKey, toggleThreeLineTable, type TableDecoration } from "./tableDecorations";
import { getImageAlignment, getSelectedTextLayout, updateImageAlignment, updateSelectedTextLayout, type TextAlignment, type TextLayoutAction } from "./textLayout";
import type { UiText } from "./i18n";

type Position = { x: number; y: number };
type BlockAction = "paragraph" | "heading-1" | "heading-2" | "heading-3" | "bullet" | "ordered" | "code";
type BlockTarget = Position & { position: number; kind: BlockAction };
type EmptyBlockTarget = Position & { position: number };
type ObjectTarget = Position & { position: number };
type TableTarget = ObjectTarget;
type EditorControlsProps = { view: EditorView | null; onSelectionChange: (text: string | null) => void; text: UiText };

const controlHandleWidth = 38;
const controlHandleHeight = 25;

function fitFloatingMenu(left: number, top: number, width: number, height: number) {
  return {
    left: Math.max(8, Math.min(left, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(top, window.innerHeight - height - 8)),
  };
}

function fitControlHandle(rect: DOMRect): Position {
  return {
    x: Math.max(8, Math.min(rect.left - controlHandleWidth - 6, window.innerWidth - controlHandleWidth - 8)),
    y: Math.max(8, Math.min(rect.top + 3, window.innerHeight - controlHandleHeight - 8)),
  };
}

function setSelectionAtBlock(view: EditorView, position: number) {
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
}

function AlignmentIcon({ alignment }: { alignment: TextAlignment }) {
  return <span className={`alignment-icon alignment-icon-${alignment}`} aria-hidden="true"><span /></span>;
}

export function EditorControls({ view, onSelectionChange, text }: EditorControlsProps) {
  const [block, setBlock] = useState<BlockTarget | null>(null);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [selectionMenu, setSelectionMenu] = useState<Position | null>(null);
  const [textLayoutMenuOpen, setTextLayoutMenuOpen] = useState(false);
  const [emptyBlock, setEmptyBlock] = useState<EmptyBlockTarget | null>(null);
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [tablePickerOpen, setTablePickerOpen] = useState(false);
  const [tableSize, setTableSize] = useState({ rows: 2, cols: 2 });
  const tablePickerTimerRef = useRef<number | null>(null);
  const tablePickerOpenRef = useRef(false);
  const [imageBlock, setImageBlock] = useState<ObjectTarget | null>(null);
  const [imageMenuOpen, setImageMenuOpen] = useState(false);
  const [tableBlock, setTableBlock] = useState<TableTarget | null>(null);
  const [tableMenuOpen, setTableMenuOpen] = useState(false);
  const [, setTableDecorationVersion] = useState(0);

  const setTablePickerVisible = (visible: boolean) => {
    tablePickerOpenRef.current = visible;
    setTablePickerOpen(visible);
  };

  useEffect(() => {
    if (!view) return;
    const editor = view.dom;
    const editorSurface = (editor.closest(".editor-stage") ?? editor) as HTMLElement;
    const blockSelector = "p, h1, h2, h3, h4, h5, h6, blockquote, pre, li";
    let hoveredObjectKey: string | null = null;
    let handleHideTimer: number | null = null;

    const keepHandlesVisible = () => {
      if (handleHideTimer !== null) {
        window.clearTimeout(handleHideTimer);
        handleHideTimer = null;
      }
    };
    const deferHandleHide = () => {
      if (tablePickerOpenRef.current) return;
      keepHandlesVisible();
      handleHideTimer = window.setTimeout(() => {
        setBlock(null);
        setEmptyBlock(null);
        setImageBlock(null);
        setImageMenuOpen(false);
        setTableBlock(null);
        setTableMenuOpen(false);
        hoveredObjectKey = null;
        handleHideTimer = null;
      }, 200);
    };

    const getNodePosition = (element: Element, nodeName: "image" | "table") => {
      let match: number | null = null;
      view.state.doc.descendants((node, position) => {
        if (node.type.name !== nodeName) return;
        const nodeDom = view.nodeDOM(position);
        if (nodeDom === element || (nodeDom instanceof Element && nodeDom.contains(element))) {
          match = position;
          return false;
        }
      });
      return match;
    };
    const showObjectHandle = (kind: "image" | "table", element: Element) => {
      const position = getNodePosition(element, kind);
      if (position === null) return;
      const key = `${kind}:${position}`;
      if (hoveredObjectKey === key) return;
      hoveredObjectKey = key;
      const rect = element.getBoundingClientRect();
      if (kind === "image") {
        setTableBlock(null);
        setTableMenuOpen(false);
        setImageBlock({ position, ...fitControlHandle(rect) });
      } else {
        setImageBlock(null);
        setImageMenuOpen(false);
        const tableElement = element instanceof HTMLTableElement ? element : element.querySelector("table");
        if (!tableElement) return;
        setTableBlock({ position, ...fitControlHandle(rect) });
      }
    };

    const findImageAtPointer = (target: Element, event?: MouseEvent) => {
      const directImage = target.closest("img");
      if (directImage instanceof HTMLImageElement) return directImage;
      if (!event) return null;

      const hoverPadding = 12;
      return Array.from(editor.querySelectorAll<HTMLImageElement>("img")).find((image) => {
        const rect = image.getBoundingClientRect();
        return event.clientX >= rect.left - hoverPadding
          && event.clientX <= rect.right + hoverPadding
          && event.clientY >= rect.top - hoverPadding
          && event.clientY <= rect.bottom + hoverPadding;
      }) ?? null;
    };

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

    const updateBlock = (target: EventTarget | null, event?: MouseEvent) => {
      if (!(target instanceof Element)) {
        deferHandleHide();
        return;
      }
      const image = findImageAtPointer(target, event);
      if (image) {
        keepHandlesVisible();
        setBlock(null);
        setEmptyBlock(null);
        setTableBlock(null);
        setTableMenuOpen(false);
        showObjectHandle("image", image);
        return;
      }
      const table = target.closest("table");
      if (table && editor.contains(table)) {
        keepHandlesVisible();
        setBlock(null);
        setEmptyBlock(null);
        setImageBlock(null);
        setImageMenuOpen(false);
        showObjectHandle("table", table);
        return;
      }
      const element = target.closest(blockSelector);
      if (!element || !editor.contains(element)) {
        deferHandleHide();
        return;
      }
      keepHandlesVisible();
      hoveredObjectKey = null;
      setImageBlock(null);
      setImageMenuOpen(false);
      setTableBlock(null);
      setTableMenuOpen(false);
      const rect = element.getBoundingClientRect();
      const position = view.posAtDOM(element, 0);
      const tag = element.tagName.toLowerCase();
      if (tag === "p" && !element.closest("table") && !element.textContent?.trim() && !element.querySelector("img, table, hr")) {
        setBlock(null);
        setBlockMenuOpen(false);
        setEmptyBlock({ position, x: Math.max(8, rect.left - 34), y: rect.top + 4 });
        return;
      }
      setEmptyBlock(null);
      const kind: BlockAction = tag === "h1" ? "heading-1"
        : tag === "h2" ? "heading-2"
          : tag === "h3" ? "heading-3"
            : tag === "pre" ? "code"
                : element.closest("ol") ? "ordered"
                  : element.closest("ul") ? "bullet"
                    : "paragraph";
      setBlock({ position, kind, ...fitControlHandle(rect) });
    };
    const updateSelection = () => {
      const selection = view.state.selection;
      if (selection.empty || !view.hasFocus() || selectionTouchesImage()) {
        setSelectionMenu(null);
        return;
      }
      const start = view.coordsAtPos(selection.from);
      const end = view.coordsAtPos(selection.to);
      setSelectionMenu({ x: Math.max(96, Math.min((start.left + end.right) / 2, window.innerWidth - 96)), y: Math.max(8, Math.min(Math.min(start.top, end.top) - 42, window.innerHeight - 38)) });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!view.state.selection.empty) return;
      if (tablePickerOpenRef.current) {
        keepHandlesVisible();
        return;
      }
      if (event.target instanceof Element && event.target.closest(".block-menu, .block-handle, .selection-toolbar, .text-layout-menu, .empty-block-add, .insert-menu, .table-picker, .object-handle, .object-menu")) {
        keepHandlesVisible();
        return;
      }
      updateBlock(event.target, event);
    };
    const focusDocumentEnd = (event: PointerEvent) => {
      const lastElement = editor.lastElementChild;
      if (!lastElement || event.clientY <= lastElement.getBoundingClientRect().bottom) return false;

      const lastNode = view.state.doc.lastChild;
      const paragraph = view.state.schema.nodes.paragraph;
      if (!lastNode || !paragraph) return false;

      event.preventDefault();
      if (lastNode.type === paragraph && lastNode.content.size === 0) {
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
      } else {
        const insertAt = view.state.doc.content.size;
        const transaction = view.state.tr.insert(insertAt, paragraph.create());
        view.dispatch(transaction.setSelection(TextSelection.create(transaction.doc, insertAt + 1)).scrollIntoView());
      }
      view.focus();
      return true;
    };
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".block-menu, .block-handle, .selection-toolbar, .text-layout-menu, .empty-block-add, .insert-menu, .object-handle, .object-menu")) return;
      hoveredObjectKey = null;
      setSelectionMenu(null);
      setTextLayoutMenuOpen(false);
      setBlock(null);
      setBlockMenuOpen(false);
      setEmptyBlock(null);
      setInsertMenuOpen(false);
      setTablePickerVisible(false);
      if (tablePickerTimerRef.current !== null) window.clearTimeout(tablePickerTimerRef.current);
      tablePickerTimerRef.current = null;
      setImageMenuOpen(false);
      setTableMenuOpen(false);
      setImageBlock(null);
      setTableBlock(null);
      focusDocumentEnd(event);
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
      if (!(target instanceof Element) || !target.closest(".block-menu, .block-handle, .selection-toolbar, .text-layout-menu, .empty-block-add, .insert-menu, .object-handle, .object-menu")) {
        setBlockMenuOpen(false);
        setTextLayoutMenuOpen(false);
        setInsertMenuOpen(false);
        setTablePickerVisible(false);
        if (tablePickerTimerRef.current !== null) window.clearTimeout(tablePickerTimerRef.current);
        tablePickerTimerRef.current = null;
        setImageMenuOpen(false);
        setTableMenuOpen(false);
        if (!(target instanceof Node) || !editor.contains(target)) setSelectionMenu(null);
      }
    };
    const onContextMenu = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("img")) return;
      updateBlock(event.target, event);
      setBlockMenuOpen(true);
      event.preventDefault();
    };
    editorSurface.addEventListener("pointermove", onPointerMove);
    editorSurface.addEventListener("pointerdown", onPointerDown);
    editorSurface.addEventListener("pointerup", onPointerUp);
    editorSurface.addEventListener("contextmenu", onContextMenu);
    editorSurface.addEventListener("keyup", updateSelection);
    document.addEventListener("pointerdown", onDocumentPointerDown);
    document.addEventListener("selectionchange", onNativeSelectionChange);
    return () => {
      editor.querySelectorAll("img.is-range-selected").forEach((image) => image.classList.remove("is-range-selected"));
      if (handleHideTimer !== null) window.clearTimeout(handleHideTimer);
      if (tablePickerTimerRef.current !== null) window.clearTimeout(tablePickerTimerRef.current);
      editorSurface.removeEventListener("pointermove", onPointerMove);
      editorSurface.removeEventListener("pointerdown", onPointerDown);
      editorSurface.removeEventListener("pointerup", onPointerUp);
      editorSurface.removeEventListener("contextmenu", onContextMenu);
      editorSurface.removeEventListener("keyup", updateSelection);
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

  const runBlockCommand = (action: BlockAction, target = block) => {
    if (!view || !target) return;
    setSelectionAtBlock(view, target.position);
    const { nodes } = view.state.schema;
    if (action === target.kind) {
      if (action === "bullet" || action === "ordered") liftListItem(nodes.list_item!)(view.state, view.dispatch, view);
      else if (action !== "paragraph") setBlockType(nodes.paragraph!)(view.state, view.dispatch, view);
      view.focus();
      setBlockMenuOpen(false);
      setInsertMenuOpen(false);
      return;
    }
    if (action === "paragraph") setBlockType(nodes.paragraph!)(view.state, view.dispatch, view);
    if (action.startsWith("heading")) setBlockType(nodes.heading!, { level: Number(action.slice(-1)) })(view.state, view.dispatch, view);
    if (action === "bullet") wrapInList(nodes.bullet_list!)(view.state, view.dispatch, view);
    if (action === "ordered") wrapInList(nodes.ordered_list!)(view.state, view.dispatch, view);
    if (action === "code") setBlockType(nodes.code_block!)(view.state, view.dispatch, view);
    view.focus();
    setBlockMenuOpen(false);
    setInsertMenuOpen(false);
  };

  const runMarkCommand = (mark: "strong" | "em" | "code" | "underline" | "strike") => {
    if (!view) return;
    const target = mark === "code"
      ? view.state.schema.marks.inlineCode
      : view.state.schema.marks[mark === "strike" ? "strike_through" : mark === "em" ? "emphasis" : mark];
    if (target) toggleMark(target)(view.state, view.dispatch, view);
    view.focus();
    setSelectionMenu(null);
    setTextLayoutMenuOpen(false);
  };

  const runTextLayoutCommand = (action: TextLayoutAction) => {
    if (!view) return;
    const transaction = updateSelectedTextLayout(view.state, action);
    if (!transaction) return;
    view.dispatch(transaction.scrollIntoView());
    view.focus();
    setTextLayoutMenuOpen(false);
  };

  const insertDivider = () => {
    if (!view || !emptyBlock) return;
    setSelectionAtBlock(view, emptyBlock.position);
    const { hr, paragraph } = view.state.schema.nodes;
    if (!hr || !paragraph) return;
    const { from } = view.state.selection;
    const transaction = view.state.tr.replaceSelectionWith(hr.create()).insert(from, paragraph.create());
    const selection = Selection.findFrom(transaction.doc.resolve(from), 1, true);
    view.dispatch(selection ? transaction.setSelection(selection).scrollIntoView() : transaction.scrollIntoView());
    view.focus();
    setInsertMenuOpen(false);
    setTablePickerVisible(false);
  };

  const insertTable = (rows: number, cols: number) => {
    if (!view || !emptyBlock) return;
    setSelectionAtBlock(view, emptyBlock.position);
    const { table, table_header_row: headerRow, table_header: header, table_row: bodyRow, table_cell: cell } = view.state.schema.nodes;
    if (!table || !headerRow || !header || !bodyRow || !cell) return;
    const headerCells = Array.from({ length: cols }, () => header.createAndFill()!);
    const bodyRows = Array.from({ length: Math.max(1, rows - 1) }, () => (
      bodyRow.create(null, Array.from({ length: cols }, () => cell.createAndFill()!))
    ));
    const tableNode = table.create(null, [headerRow.create(null, headerCells), ...bodyRows]);
    const { from } = view.state.selection;
    const transaction = view.state.tr.replaceSelectionWith(tableNode);
    const selection = Selection.findFrom(transaction.doc.resolve(from), 1, true);
    view.dispatch(selection ? transaction.setSelection(selection).scrollIntoView() : transaction.scrollIntoView());
    view.focus();
    setInsertMenuOpen(false);
    setTablePickerVisible(false);
  };

  const selectObject = (target: ObjectTarget) => {
    if (!view) return false;
    const node = view.state.doc.nodeAt(target.position);
    if (!node) return false;
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, target.position)));
    view.focus();
    return true;
  };
  const copyObject = (target: ObjectTarget) => {
    if (!selectObject(target)) return;
    document.execCommand("copy");
  };
  const cutObject = (target: ObjectTarget) => {
    if (!view || !selectObject(target)) return;
    document.execCommand("copy");
    view.dispatch(view.state.tr.delete(target.position, target.position + (view.state.doc.nodeAt(target.position)?.nodeSize ?? 0)).scrollIntoView());
  };
  const deleteObject = (target: ObjectTarget) => {
    if (!view) return;
    const node = view.state.doc.nodeAt(target.position);
    if (!node) return;
    view.dispatch(view.state.tr.delete(target.position, target.position + node.nodeSize).scrollIntoView());
    view.focus();
  };
  const setImageAlignment = (alignment: TextAlignment) => {
    if (!view || !imageBlock) return;
    const result = updateImageAlignment(view.state, imageBlock.position, alignment);
    if (!result) return;
    view.dispatch(result.transaction.scrollIntoView());
    view.focus();
    setImageBlock((current) => current && current.position === imageBlock.position
      ? { ...current, position: result.imagePosition }
      : current);
    setImageMenuOpen(false);
  };
  const toggleTableDecoration = (field: keyof TableDecoration) => {
    if (!tableBlock || !view) return;
    const next = { ...getTableDecoration(tableBlock.position, view.state) };
    next[field] = !next[field];
    view.dispatch(view.state.tr.setMeta(tableDecorationPluginKey, setTableDecoration(tableBlock.position, next)));
    setTableDecorationVersion((version) => version + 1);
  };
  const toggleTableThreeLine = () => {
    if (!tableBlock || !view) return;
    const result = toggleThreeLineTable(view.state, tableBlock.position);
    if (!result) return;
    view.dispatch(result.transaction.scrollIntoView());
    setTableBlock((current) => current && current.position === tableBlock.position
      ? { ...current, position: result.tablePosition }
      : current);
    setTableDecorationVersion((version) => version + 1);
  };
  const openTablePickerAfterDelay = () => {
    if (tablePickerOpen || tablePickerTimerRef.current !== null) return;
    tablePickerTimerRef.current = window.setTimeout(() => {
      setTablePickerVisible(true);
      tablePickerTimerRef.current = null;
    }, 250);
  };
  const cancelPendingTablePicker = () => {
    if (tablePickerOpen || tablePickerTimerRef.current === null) return;
    window.clearTimeout(tablePickerTimerRef.current);
    tablePickerTimerRef.current = null;
  };

  const isMarkActive = (mark: "strong" | "em" | "code" | "strike") => {
    if (!view) return false;
    const target = mark === "code"
      ? view.state.schema.marks.inlineCode
      : view.state.schema.marks[mark === "strike" ? "strike_through" : mark === "em" ? "emphasis" : mark];
    return Boolean(target && (view.state.selection.$from.marks().some((item) => item.type === target)
      || view.state.doc.rangeHasMark(view.state.selection.from, view.state.selection.to, target)));
  };

  const insertMenuPosition = emptyBlock ? fitFloatingMenu(emptyBlock.x - 2, emptyBlock.y + 28, 202, 220) : null;
  const tablePickerPosition = insertMenuPosition
    ? fitFloatingMenu(
      insertMenuPosition.left + 202 + 4 + 154 > window.innerWidth - 8 ? insertMenuPosition.left - 4 - 154 : insertMenuPosition.left + 202 + 4,
      insertMenuPosition.top - 5,
      154,
      170,
    )
    : null;
  const selectedTextLayout = selectionMenu && view ? getSelectedTextLayout(view.state) : null;
  const imageAlignment = imageBlock && view ? getImageAlignment(view.state, imageBlock.position) : "left";
  const textLayoutMenuPosition = selectionMenu
    ? fitFloatingMenu(selectionMenu.x - 84, selectionMenu.y + 32, 168, 168)
    : null;

  return <>
    {imageBlock && !selectionMenu && <button
      type="button"
      className="object-handle image-object-handle"
      style={{ left: imageBlock.x, top: imageBlock.y }}
      title={text.imageOperations}
      aria-label={text.imageOperations}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => { setImageMenuOpen((open) => !open); setTableMenuOpen(false); }}
    ><span>▧</span><span>⠿</span></button>}
    {imageBlock && imageMenuOpen && <div className="object-menu image-object-menu" style={fitFloatingMenu(imageBlock.x - 2, imageBlock.y + 27, 164, 230)} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className={imageAlignment === "left" ? "is-active" : ""} onClick={() => setImageAlignment("left")}><span className="alignment-menu-label"><AlignmentIcon alignment="left" />{text.leftAlign}</span>{imageAlignment === "left" && <span aria-hidden="true">✓</span>}</button>
      <button type="button" className={imageAlignment === "center" ? "is-active" : ""} onClick={() => setImageAlignment("center")}><span className="alignment-menu-label"><AlignmentIcon alignment="center" />{text.centerAlign}</span>{imageAlignment === "center" && <span aria-hidden="true">✓</span>}</button>
      <button type="button" className={imageAlignment === "right" ? "is-active" : ""} onClick={() => setImageAlignment("right")}><span className="alignment-menu-label"><AlignmentIcon alignment="right" />{text.rightAlign}</span>{imageAlignment === "right" && <span aria-hidden="true">✓</span>}</button>
      <div className="object-menu-divider" />
      <button type="button" onClick={() => { copyObject(imageBlock); setImageMenuOpen(false); }}>{text.copy} <kbd>Ctrl+C</kbd></button>
      <button type="button" onClick={() => { cutObject(imageBlock); setImageMenuOpen(false); setImageBlock(null); }}>{text.cut} <kbd>Ctrl+X</kbd></button>
      <button type="button" onClick={() => { deleteObject(imageBlock); setImageMenuOpen(false); setImageBlock(null); }}>{text.delete} <kbd>Delete</kbd></button>
    </div>}
    {tableBlock && !selectionMenu && <button
      type="button"
      className="object-handle table-object-handle"
      style={{ left: tableBlock.x, top: tableBlock.y }}
      title={text.tableOperations}
      aria-label={text.tableOperations}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => { setTableMenuOpen((open) => !open); setImageMenuOpen(false); }}
    ><span>▦</span><span>⠿</span></button>}
    {tableBlock && tableMenuOpen && <div className="object-menu table-object-menu" style={fitFloatingMenu(tableBlock.x - 172, tableBlock.y + 27, 164, 255)} onMouseDown={(event) => event.preventDefault()}>
      {(() => {
        const isThreeLine = getTableDecoration(tableBlock.position, view!.state).threeLine;
        return <>
      <button type="button" onClick={() => selectObject(tableBlock)}>{text.selectTable}</button>
      <button type="button" className={isThreeLine ? "is-active" : ""} aria-pressed={isThreeLine} onClick={toggleTableThreeLine}>{text.convertThreeLineTable}</button>
      <div className="object-menu-divider" />
      <button type="button" className="object-menu-toggle" disabled={isThreeLine} onClick={() => toggleTableDecoration("titleRow")}><span>{text.setTitleRow}</span><span className={`switch ${getTableDecoration(tableBlock.position, view!.state).titleRow ? "is-on" : ""}`} /></button>
      <button type="button" className="object-menu-toggle" disabled={isThreeLine} onClick={() => toggleTableDecoration("titleColumn")}><span>{text.setTitleColumn}</span><span className={`switch ${getTableDecoration(tableBlock.position, view!.state).titleColumn ? "is-on" : ""}`} /></button>
      <div className="object-menu-divider" />
      <button type="button" onClick={() => { copyObject(tableBlock); setTableMenuOpen(false); }}>{text.copy} <kbd>Ctrl+C</kbd></button>
      <button type="button" onClick={() => { cutObject(tableBlock); setTableMenuOpen(false); setTableBlock(null); }}>{text.cut} <kbd>Ctrl+X</kbd></button>
      <button type="button" onClick={() => { deleteObject(tableBlock); setTableMenuOpen(false); setTableBlock(null); }}>{text.delete} <kbd>Delete</kbd></button>
        </>;
      })()}
    </div>}
    {emptyBlock && !selectionMenu && <button
      type="button"
      className="empty-block-add"
      style={{ left: emptyBlock.x, top: emptyBlock.y }}
      title={text.insertContent}
      aria-label={text.insertContent}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        setInsertMenuOpen((open) => !open);
        setTablePickerVisible(false);
        setTableSize({ rows: 2, cols: 2 });
        if (tablePickerTimerRef.current !== null) window.clearTimeout(tablePickerTimerRef.current);
        tablePickerTimerRef.current = null;
      }}
    >＋</button>}
    {emptyBlock && insertMenuOpen && insertMenuPosition && <div className="insert-menu" style={insertMenuPosition} onMouseDown={(event) => event.preventDefault()}>
      <div className="insert-block-row">
        <button className="is-active" type="button" title={text.bodyTooltip} onClick={() => runBlockCommand("paragraph", { ...emptyBlock, kind: "paragraph" })}>{text.body}</button>
        <button type="button" title={text.headingTooltip(1)} onClick={() => runBlockCommand("heading-1", { ...emptyBlock, kind: "paragraph" })}>H1</button>
        <button type="button" title={text.headingTooltip(2)} onClick={() => runBlockCommand("heading-2", { ...emptyBlock, kind: "paragraph" })}>H2</button>
        <button type="button" title={text.headingTooltip(3)} onClick={() => runBlockCommand("heading-3", { ...emptyBlock, kind: "paragraph" })}>H3</button>
      </div>
      <div className="insert-block-row">
        <button type="button" title={text.bulletListTooltip} onClick={() => runBlockCommand("bullet", { ...emptyBlock, kind: "paragraph" })}>{text.bulletList}</button>
        <button type="button" title={text.orderedListTooltip} onClick={() => runBlockCommand("ordered", { ...emptyBlock, kind: "paragraph" })}>{text.orderedList}</button>
        <button type="button" title={text.codeBlockTooltip} onClick={() => runBlockCommand("code", { ...emptyBlock, kind: "paragraph" })}>{text.codeBlock}</button>
      </div>
      <div className="insert-menu-divider" />
      <button type="button" className="insert-menu-item" onMouseEnter={openTablePickerAfterDelay} onMouseLeave={cancelPendingTablePicker} onClick={openTablePickerAfterDelay}>
        <span>▦ {text.table}</span><span aria-hidden="true">›</span>
      </button>
      {tablePickerOpen && tablePickerPosition && <div className="table-picker" style={tablePickerPosition} onMouseLeave={() => undefined} onClick={() => insertTable(tableSize.rows, tableSize.cols)}>
        <div className="table-picker-label">{text.tableDimensions(tableSize.rows, tableSize.cols)}</div>
        <div className="table-picker-grid" role="grid" aria-label={text.chooseTableDimensions}>
          {Array.from({ length: 64 }, (_, index) => {
            const row = Math.floor(index / 8) + 1;
            const col = (index % 8) + 1;
            const selected = row <= tableSize.rows && col <= tableSize.cols;
            return <button key={`${row}-${col}`} type="button" role="gridcell" className={selected ? "is-selected" : ""} aria-label={text.tableCell(row, col)} onMouseEnter={() => setTableSize({ rows: Math.max(2, row), cols: col })} onClick={(event) => { event.stopPropagation(); insertTable(Math.max(2, row), col); }} />;
          })}
        </div>
      </div>}
      <button type="button" className="insert-menu-item" onClick={insertDivider}><span>— {text.divider}</span></button>
    </div>}
    {block && !selectionMenu && <button
      type="button"
      className="block-handle"
      style={{ left: block.x, top: block.y }}
      title={text.blockMenu}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => setBlockMenuOpen((open) => !open)}
      aria-label={text.blockMenu}
    ><span className="block-handle-label">{blockLabel}</span><span>⠿</span></button>}
    {block && blockMenuOpen && <div className="block-menu" style={fitFloatingMenu(block.x - 208, block.y, 202, 104)} onMouseDown={(event) => event.preventDefault()}>
      <div className="block-menu-row">
        <button className={block.kind === "paragraph" ? "is-active" : ""} type="button" title={text.bodyTooltip} onClick={() => runBlockCommand("paragraph")}>{text.body}</button>
        <button className={block.kind === "heading-1" ? "is-active" : ""} type="button" title={text.headingTooltip(1)} onClick={() => runBlockCommand("heading-1")}>H1</button>
        <button className={block.kind === "heading-2" ? "is-active" : ""} type="button" title={text.headingTooltip(2)} onClick={() => runBlockCommand("heading-2")}>H2</button>
        <button className={block.kind === "heading-3" ? "is-active" : ""} type="button" title={text.headingTooltip(3)} onClick={() => runBlockCommand("heading-3")}>H3</button>
      </div>
      <div className="block-menu-row">
        <button className={block.kind === "bullet" ? "is-active" : ""} type="button" title={text.bulletListTooltip} onClick={() => runBlockCommand("bullet")}>{text.bulletList}</button>
        <button className={block.kind === "ordered" ? "is-active" : ""} type="button" title={text.orderedListTooltip} onClick={() => runBlockCommand("ordered")}>{text.orderedList}</button>
        <button className={block.kind === "code" ? "is-active" : ""} type="button" title={text.codeBlockTooltip} onClick={() => runBlockCommand("code")}>{text.codeBlock}</button>
      </div>
    </div>}
    {selectionMenu && <div className="selection-toolbar" style={{ left: selectionMenu.x, top: selectionMenu.y }} onMouseDown={(event) => event.preventDefault()}>
      <button className={isMarkActive("strong") ? "is-active" : ""} type="button" title={text.boldTooltip} onClick={() => runMarkCommand("strong")}><b>B</b></button>
      <button className={isMarkActive("em") ? "is-active" : ""} type="button" title={text.italicTooltip} onClick={() => runMarkCommand("em")}><i>I</i></button>
      <button className={isMarkActive("strike") ? "is-active" : ""} type="button" title={text.strikethroughTooltip} onClick={() => runMarkCommand("strike")}><s>S</s></button>
      <span className="selection-toolbar-divider" />
      <button type="button" className={`selection-align-button ${textLayoutMenuOpen ? "is-active" : ""}`} title={text.alignmentAndIndent} aria-label={text.alignmentAndIndent} onClick={() => setTextLayoutMenuOpen((open) => !open)}><AlignmentIcon alignment={selectedTextLayout?.alignment ?? "left"} /></button>
      <button className={isMarkActive("code") ? "is-active" : ""} type="button" title={text.inlineCodeTooltip} onClick={() => runMarkCommand("code")}>‹/›</button>
    </div>}
    {selectionMenu && textLayoutMenuOpen && textLayoutMenuPosition && <div className="text-layout-menu" style={textLayoutMenuPosition} onMouseDown={(event) => event.preventDefault()}>
      <button type="button" className={selectedTextLayout?.alignment === "left" ? "is-active" : ""} onClick={() => runTextLayoutCommand({ type: "alignment", value: "left" })}><span className="alignment-menu-label"><AlignmentIcon alignment="left" />{text.leftAlign}</span>{selectedTextLayout?.alignment === "left" && <span aria-hidden="true">✓</span>}</button>
      <button type="button" className={selectedTextLayout?.alignment === "center" ? "is-active" : ""} onClick={() => runTextLayoutCommand({ type: "alignment", value: "center" })}><span className="alignment-menu-label"><AlignmentIcon alignment="center" />{text.centerAlign}</span>{selectedTextLayout?.alignment === "center" && <span aria-hidden="true">✓</span>}</button>
      <button type="button" className={selectedTextLayout?.alignment === "right" ? "is-active" : ""} onClick={() => runTextLayoutCommand({ type: "alignment", value: "right" })}><span className="alignment-menu-label"><AlignmentIcon alignment="right" />{text.rightAlign}</span>{selectedTextLayout?.alignment === "right" && <span aria-hidden="true">✓</span>}</button>
      <div className="text-layout-menu-divider" />
      <button type="button" className={selectedTextLayout?.firstLineIndent ? "is-active" : ""} onClick={() => runTextLayoutCommand({ type: "first-line-indent" })}><span>↦　{text.firstLineIndent}</span>{selectedTextLayout?.firstLineIndent ? <span aria-hidden="true">✓</span> : <kbd>{text.twoCharacters}</kbd>}</button>
    </div>}
  </>;
}
