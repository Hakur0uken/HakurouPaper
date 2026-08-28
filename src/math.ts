import katex from "katex";
import "katex/dist/katex.min.css";
import remarkMath from "remark-math";
import { $inputRule, $node, $prose, $remark, $view } from "@milkdown/utils";
import { InputRule } from "@milkdown/prose/inputrules";
import { keymap } from "@milkdown/prose/keymap";
import { NodeSelection, Plugin } from "@milkdown/prose/state";
import { Fragment, Slice, type Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView, NodeView } from "@milkdown/prose/view";

type FormulaNodeViewOptions = {
  displayMode: boolean;
  className: string;
};

class FormulaNodeView implements NodeView {
  dom: HTMLElement;
  private readonly view: EditorView;
  private readonly getPos: () => number | undefined;
  private readonly options: FormulaNodeViewOptions;
  private node: ProseNode;
  private editing = false;
  private readonly onNumberingRefresh: () => void;

  constructor(node: ProseNode, view: EditorView, getPos: () => number | undefined, options: FormulaNodeViewOptions) {
    this.node = node;
    this.view = view;
    this.getPos = getPos;
    this.options = options;
    this.dom = document.createElement(options.displayMode ? "div" : "span");
    this.dom.className = options.className;
    this.dom.contentEditable = "false";
    this.onNumberingRefresh = () => {
      if (this.options.displayMode && !this.editing) this.renderPreview();
    };
    this.view.dom.addEventListener("hakurou-formula-numbering-refresh", this.onNumberingRefresh);
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

  destroy() {
    this.view.dom.removeEventListener("hakurou-formula-numbering-refresh", this.onNumberingRefresh);
  }

  private renderPreview() {
    this.editing = false;
    this.dom.replaceChildren();
    const preview = document.createElement("span");
    const value = String(this.node.attrs.value ?? "");
    preview.className = "hakurou-formula-preview";
    preview.innerHTML = katex.renderToString(stripFormulaLayoutCommands(value) || "\\text{双击输入公式}", {
      displayMode: this.options.displayMode,
      throwOnError: false,
      strict: "ignore",
    });
    if (this.options.displayMode) {
      const layout = document.createElement("span");
      layout.className = "hakurou-formula-block-layout";
      layout.append(preview);
      const label = this.formulaNumberLabel(value);
      if (label) {
        const number = document.createElement("span");
        number.className = "hakurou-formula-number";
        number.textContent = label;
        number.setAttribute("aria-label", `公式编号 ${label}`);
        layout.append(number);
      }
      this.dom.append(layout);
    } else {
      this.dom.append(preview);
    }
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
    if (this.options.displayMode) {
      const numbering = document.createElement("label");
      numbering.className = "hakurou-formula-numbering-toggle";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = formulaUsesNumber(valueOrEmpty(this.node));
      const label = document.createElement("span");
      label.textContent = "右侧编号";
      checkbox.addEventListener("change", () => {
        textarea.value = setFormulaNumbering(textarea.value, checkbox.checked);
      });
      numbering.append(checkbox, label);
      controls.append(numbering);
    }
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

  private formulaNumberLabel(value: string) {
    if (!formulaUsesNumber(value)) return null;
    const explicitTag = findEquationTag(value);
    if (explicitTag) return formatEquationTag(explicitTag);

    const position = this.getPos();
    if (typeof position !== "number") return null;
    let sequence = 0;
    this.view.state.doc.nodesBetween(0, position, (node) => {
      if (node.type.name !== "hakurou_block_formula") return;
      const earlierValue = valueOrEmpty(node);
      if (!formulaUsesNumber(earlierValue)) return;
      const tag = findEquationTag(earlierValue);
      const explicitNumber = tag && numericEquationTag(tag.value);
      sequence = explicitNumber ?? sequence + 1;
    });
    return `(${sequence + 1})`;
  }
}

type EquationTag = {
  value: string;
  starred: boolean;
};

function valueOrEmpty(node: ProseNode) {
  return String(node.attrs.value ?? "");
}

function formulaUsesNumber(value: string) {
  return !/\\(?:notag|nonumber)\b/.test(value);
}

function setFormulaNumbering(value: string, enabled: boolean) {
  const withoutSuppression = value.replace(/\s*\\(?:notag|nonumber)\b/g, "").trimEnd();
  return enabled ? withoutSuppression : `${withoutSuppression}${withoutSuppression ? "\n" : ""}\\notag`;
}

function stripFormulaLayoutCommands(value: string) {
  return value
    .replace(/\\(?:notag|nonumber)\b/g, "")
    .replace(/\\tag\*?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .trim();
}

function findEquationTag(value: string): EquationTag | null {
  const pattern = /\\tag(\*)?\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g;
  let found: EquationTag | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const tag = match[2]?.trim();
    if (tag) found = { value: tag, starred: Boolean(match[1]) };
  }
  return found;
}

function formatEquationTag(tag: EquationTag) {
  if (tag.starred || /^\(.*\)$/.test(tag.value)) return tag.value;
  return `(${tag.value})`;
}

function numericEquationTag(value: string) {
  const match = value.match(/^\(?\s*(\d+)\s*\)?$/);
  return match ? Number(match[1]) : null;
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

/** Repaint all visible block labels after a formula is inserted, removed, or moved. */
export const formulaNumberingRefresh = $prose(() => new Plugin({
  view() {
    return {
      update(nextView, previousState) {
        if (!nextView.state.doc.eq(previousState.doc)) {
          nextView.dom.dispatchEvent(new Event("hakurou-formula-numbering-refresh"));
        }
      },
    };
  },
}));

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
  formulaNumberingRefresh,
];
