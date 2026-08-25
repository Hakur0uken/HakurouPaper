import katex from "katex";
import remarkMath from "remark-math";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { imageSchema } from "@milkdown/preset-commonmark";
import { $inputRule, $node, $prose, $remark, $view } from "@milkdown/utils";
import { InputRule } from "@milkdown/prose/inputrules";
import { keymap } from "@milkdown/prose/keymap";
import { NodeSelection, Plugin, Selection } from "@milkdown/prose/state";
import { Fragment, Slice, type Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";

type FormulaNodeViewOptions = {
  displayMode: boolean;
  className: string;
};

type SavedImage = {
  relativePath: string;
  assetFolder: string;
};

class FormulaNodeView implements NodeView {
  dom: HTMLElement;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly options: FormulaNodeViewOptions;
  private node: ProseNode;
  private editing = false;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined, options: FormulaNodeViewOptions) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.options = options;
    this.dom = document.createElement(options.displayMode ? "div" : "span");
    this.dom.className = options.className;
    this.dom.contentEditable = "false";
    this.renderPreview();
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.editing = false;
    this.renderPreview();
    return true;
  }

  selectNode() {
    this.dom.classList.add("is-selected");
  }

  deselectNode() {
    this.dom.classList.remove("is-selected");
  }

  stopEvent(event: Event) {
    return this.editing || event.type === "dblclick";
  }

  ignoreMutation() {
    return true;
  }

  private renderPreview() {
    this.editing = false;
    this.dom.replaceChildren();
    const preview = document.createElement("span");
    const value = String(this.node.attrs.value ?? "");
    preview.innerHTML = katex.renderToString(value || "\\text{双击输入公式}", {
      displayMode: this.options.displayMode,
      throwOnError: false,
      strict: "ignore",
    });
    this.dom.append(preview);
    this.dom.title = "双击编辑 LaTeX 源码";
    this.dom.ondblclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.renderEditor();
    };
  }

  private renderEditor() {
    this.editing = true;
    this.dom.replaceChildren();
    const textarea = document.createElement("textarea");
    textarea.className = "hakurou-formula-source";
    textarea.value = String(this.node.attrs.value ?? "");
    textarea.spellcheck = false;
    textarea.setAttribute("aria-label", "LaTeX 源码");

    const actions = document.createElement("div");
    actions.className = "hakurou-formula-actions";
    const hint = document.createElement("span");
    hint.textContent = "Ctrl Enter 确认 · Esc 取消";
    const controls = document.createElement("div");
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => this.renderPreview());
    const apply = document.createElement("button");
    apply.type = "button";
    apply.className = "is-confirm";
    apply.textContent = "应用";
    apply.addEventListener("click", () => this.commitValue(textarea.value));
    controls.append(cancel, apply);
    actions.append(hint, controls);
    this.dom.append(textarea, actions);

    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        this.commitValue(textarea.value);
      }
      if (event.key === "Escape") {
        event.preventDefault();
        this.renderPreview();
      }
    });
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.select();
    });
  }

  private commitValue(value: string) {
    const position = this.getPos();
    if (typeof position !== "number") return;
    const attrs = { ...this.node.attrs, value };
    this.view.dispatch(this.view.state.tr.setNodeMarkup(position, undefined, attrs));
  }
}

const formulaRemark = $remark("hakurouFormulaRemark", () => remarkMath);

export const inlineFormula = $node("hakurou_inline_formula", () => ({
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  attrs: { value: { default: "" } },
  parseDOM: [{ tag: "span[data-hakurou-inline-formula]", getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }) }],
  toDOM: (node) => ["span", { "data-hakurou-inline-formula": "", "data-value": node.attrs.value }],
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => state.addNode(type, { value: String(node.value ?? "") }),
  },
  toMarkdown: {
    match: (node) => node.type.name === "hakurou_inline_formula",
    runner: (state, node) => state.addNode("inlineMath", undefined, String(node.attrs.value ?? "")),
  },
}));

export const blockFormula = $node("hakurou_block_formula", () => ({
  group: "block",
  atom: true,
  selectable: true,
  attrs: { value: { default: "" } },
  parseDOM: [{ tag: "div[data-hakurou-block-formula]", getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }) }],
  toDOM: (node) => ["div", { "data-hakurou-block-formula": "", "data-value": node.attrs.value }],
  parseMarkdown: {
    match: (node) => node.type === "math",
    runner: (state, node, type) => state.addNode(type, { value: String(node.value ?? "") }),
  },
  toMarkdown: {
    match: (node) => node.type.name === "hakurou_block_formula",
    runner: (state, node) => state.addNode("math", undefined, String(node.attrs.value ?? "")),
  },
}));

export const inlineFormulaView = $view(inlineFormula, () => (node, view, getPos) => (
  new FormulaNodeView(node, view, getPos, { displayMode: false, className: "hakurou-formula hakurou-formula-inline" })
));

export const blockFormulaView = $view(blockFormula, () => (node, view, getPos) => (
  new FormulaNodeView(node, view, getPos, { displayMode: true, className: "hakurou-formula hakurou-formula-block" })
));

export const inlineFormulaInputRule = $inputRule((ctx) => new InputRule(/\$([^$\n]+)\$$/, (state, match, start, end) => {
  const value = match[1];
  if (!value) return null;
  return state.tr.replaceWith(start, end, inlineFormula.type(ctx).create({ value }));
}));

export const blockFormulaEnterRule = $prose((ctx) => keymap({
  Enter: (state, dispatch) => {
    const { $from } = state.selection;
    if (!$from.parent.isTextblock || $from.parent.type.name !== "paragraph" || $from.parent.textContent !== "$$") return false;
    const start = $from.before();
    const formula = blockFormula.type(ctx).create({ value: "" });
    const transaction = state.tr.replaceWith(start, start + $from.parent.nodeSize, formula);
    dispatch?.(transaction.setSelection(NodeSelection.create(transaction.doc, start)));
    return true;
  },
}));

function blockFormulaFromPaste(text: string) {
  const normalized = text.trim();
  const dollarDelimited = normalized.match(/^\$\$\s*\n?([\s\S]*?)\n?\$\$$/);
  if (dollarDelimited) return dollarDelimited[1]!.trim();
  const bracketDelimited = normalized.match(/^\\\[\s*([\s\S]*?)\s*\\\]$/);
  if (bracketDelimited) return bracketDelimited[1]!.trim();
  if (!normalized.includes("\n") && /\\[A-Za-z]+|[{}^_]/.test(normalized)) return normalized;
  return null;
}

function inlineFormulaFromPaste(text: string) {
  const normalized = text.trim();
  const dollarDelimited = normalized.match(/^\$([^$\n]+)\$$/);
  if (dollarDelimited) return dollarDelimited[1]!;
  const parenthesisDelimited = normalized.match(/^\\\(([\s\S]+)\\\)$/);
  if (parenthesisDelimited) return parenthesisDelimited[1]!.trim();
  if (!normalized.includes("\n") && /\\[A-Za-z]+|[{}^_]/.test(normalized)) return normalized;
  return null;
}

export const formulaPasteRule = $prose((ctx) => new Plugin({
  props: {
    handlePaste(view, event) {
      const text = event.clipboardData?.getData("text/plain");
      if (!text) return false;

      const { state } = view;
      const { $from } = state.selection;
      const pastedBlockFormula = blockFormulaFromPaste(text);
      if (pastedBlockFormula !== null && $from.parent.type.name === "paragraph" && $from.parent.content.size === 0) {
        const start = $from.before();
        const formula = blockFormula.type(ctx).create({ value: pastedBlockFormula });
        const transaction = state.tr.replaceWith(start, start + $from.parent.nodeSize, formula);
        event.preventDefault();
        view.dispatch(transaction.setSelection(NodeSelection.create(transaction.doc, start)));
        return true;
      }

      const exactInlineFormula = inlineFormulaFromPaste(text);
      if (exactInlineFormula !== null) {
        event.preventDefault();
        view.dispatch(state.tr.replaceSelectionWith(inlineFormula.type(ctx).create({ value: exactInlineFormula })));
        return true;
      }

      if (!text.includes("$")) return false;
      const content: ProseNode[] = [];
      const pattern = /\$([^$\n]+)\$/g;
      let cursor = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        if (match.index > cursor) content.push(state.schema.text(text.slice(cursor, match.index)));
        content.push(inlineFormula.type(ctx).create({ value: match[1] }));
        cursor = match.index + match[0].length;
      }
      if (content.length === 0) return false;
      if (cursor < text.length) content.push(state.schema.text(text.slice(cursor)));
      event.preventDefault();
      view.dispatch(state.tr.replaceSelection(new Slice(Fragment.fromArray(content), 0, 0)));
      return true;
    },
  },
}));

export const imageCursorNavigation = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
      const { state } = view;
      if (!state.selection.empty) return false;
      const { $from } = state.selection;
      const movingLeft = event.key === "ArrowLeft";
      const neighbor = movingLeft ? $from.nodeBefore : $from.nodeAfter;
      if (neighbor?.type.name !== "image") return false;

      const target = movingLeft ? $from.pos - neighbor.nodeSize : $from.pos + neighbor.nodeSize;
      event.preventDefault();
      view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(target), movingLeft ? -1 : 1)));
      return true;
    },
  },
}));

function imageSourceForEditor(source: string, documentPath: string | null) {
  if (!documentPath || /^(?:data:|https?:|asset:|blob:)/i.test(source)) return source;
  const documentFolder = documentPath.replace(/[\\/][^\\/]+$/, "");
  const relativeSource = source.replace(/^\.\//, "").replace(/\//g, "\\");
  return convertFileSrc(`${documentFolder}\\${relativeSource}`);
}

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片。"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const separator = dataUrl.indexOf(",");
      resolve(separator >= 0 ? dataUrl.slice(separator + 1) : dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

export function createImageAssetPlugins(
  documentPath: string | null,
  assetFolder: string | null,
  onAssetFolderChange: (folder: string) => void,
) {
  const localImageView = $view(imageSchema.node, () => (node) => {
    const image = document.createElement("img");
    image.contentEditable = "false";
    image.draggable = true;
    const updateImage = (nextNode: ProseNode) => {
      image.src = imageSourceForEditor(String(nextNode.attrs.src ?? ""), documentPath);
      image.alt = String(nextNode.attrs.alt ?? "");
      image.title = String(nextNode.attrs.title ?? nextNode.attrs.alt ?? "");
    };
    updateImage(node);
    return {
      dom: image,
      update(nextNode: ProseNode) {
        if (nextNode.type !== node.type) return false;
        updateImage(nextNode);
        return true;
      },
    };
  });

  const localImagePaste = $prose((ctx) => new Plugin({
    props: {
      handlePaste(view, event) {
        const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
        if (!image) return false;
        event.preventDefault();
        if (!documentPath) {
          window.alert("请先保存文稿，再粘贴图片。保存后图片会自动放入同级 assets 文件夹。");
          return true;
        }
        void (async () => {
          try {
            const dataBase64 = await fileToBase64(image);
            const savedImage = await invoke<SavedImage>("save_pasted_image", {
              documentPath,
              dataBase64,
              mimeType: image.type,
              assetFolder,
            });
            onAssetFolderChange(savedImage.assetFolder);
            const imageNode = imageSchema.type(ctx).create({ src: savedImage.relativePath, alt: "", title: "" });
            view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
          } catch (error) {
            window.alert(`无法粘贴图片：${String(error)}`);
          }
        })();
        return true;
      },
    },
  }));

  return [localImageView, localImagePaste];
}

export const formulaPlugins = [
  formulaRemark.options,
  formulaRemark.plugin,
  inlineFormula,
  blockFormula,
  inlineFormulaView,
  blockFormulaView,
  inlineFormulaInputRule,
  blockFormulaEnterRule,
  formulaPasteRule,
  imageCursorNavigation,
];
