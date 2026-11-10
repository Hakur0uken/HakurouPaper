import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as unifiedModule from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Schema } from "@milkdown/prose/model";
import * as proseState from "@milkdown/prose/state";
import * as proseTransform from "@milkdown/prose/transform";
import * as proseHistory from "@milkdown/prose/history";
import * as proseView from "@milkdown/prose/view";

const modules = {
  unified: unifiedModule, "remark-parse": { default: remarkParse }, "remark-gfm": { default: remarkGfm }, "remark-math": { default: remarkMath },
  "@milkdown/prose/state": proseState, "@milkdown/prose/transform": proseTransform, "@milkdown/prose/history": proseHistory,
  "@milkdown/prose/view": proseView, "@milkdown/utils": { $prose: (factory) => factory() },
};
for (const [name, file] of [
  ["../collaboration/sequenceChanges", "collaboration/sequenceChanges"],
  ["./formatTypes", "formatTypes"], ["./editor/formatRestore", "editor/formatRestore"],
  ["./tableDecorations", "tableDecorations"], ["./textLayout", "textLayout"],
  ["./sourceMirror", "editor/sourceMirror"], ["./sourceEditing", "editor/sourceEditing"],
]) {
  const source = await readFile(new URL(`../src/${file}.ts`, import.meta.url), "utf8");
  const context = { exports: {}, console, require: (name) => { if (!modules[name]) throw new Error(name); return modules[name]; } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  modules[name] = context.exports;
}
const { createSourceEditing, sourceEditingKey } = modules["./sourceEditing"];
const schema = new Schema({ nodes: { doc: { content: "block+" }, text: { group: "inline" }, paragraph: { group: "block", content: "inline*" }, heading: { group: "block", content: "inline*", attrs: { level: { default: 1 }, id: { default: "" } } } }, marks: { strong: {} } });
const processor = unifiedModule.unified().use(remarkParse);
const parse = (markdown) => {
  const inline = (node, marks = []) => node.type === "text" ? [schema.text(node.value, marks)] : (node.children ?? []).flatMap((child) => inline(child, node.type === "strong" ? [...marks, schema.mark("strong")] : marks));
  const blocks = processor.parse(markdown).children.filter((node) => node.type !== "definition").map((node) => schema.node(node.type === "heading" ? "heading" : "paragraph", { level: node.depth ?? 1 }, (node.children ?? []).flatMap((child) => inline(child))));
  return schema.node("doc", null, blocks.length ? blocks : [schema.node("paragraph")]);
};
const serialize = (doc) => {
  const blocks = [];
  doc.forEach((node) => { let text = ""; node.forEach((child) => { text += child.marks.length ? `**${child.text}**` : child.text; }); blocks.push((node.type.name === "heading" ? "#".repeat(node.attrs.level) + " " : "") + text); });
  return blocks.join("\n\n") + "\n";
};
function editor(markdown, contextChanged, restoreContext, extraPlugins = []) {
  let api;
  const plugin = createSourceEditing(markdown, parse, serialize, () => {}, (value) => { api = value; }, contextChanged, restoreContext);
  let state = proseState.EditorState.create({ doc: parse(markdown), plugins: [proseHistory.history(), ...extraPlugins, plugin] });
  let pluginView;
  let steps = [];
  const view = { get state() { return state; }, composing: false, dispatch(tr) { const previous = state; const applied = state.applyTransaction(tr); state = applied.state; steps = applied.transactions.flatMap(tr => tr.steps); pluginView?.update(view, previous); }, focus() {} };
  pluginView = plugin.spec.view(view);
  return { view, api, steps: () => steps, text: () => sourceEditingKey.getState(state).snapshot.markdown, undo: () => proseHistory.undo(state, view.dispatch), redo: () => proseHistory.redo(state, view.dispatch) };
}

test("editing one paragraph preserves unrelated heading spelling, emphasis, gaps and CRLF", () => {
  const original = "Title\r\n=====\r\n\r\n\r\n__bold__\r\n\r\nlast paragraph";
  const e = editor(original);
  const at = e.view.state.doc.content.size - 1;
  e.view.dispatch(e.view.state.tr.insertText("!", at));
  assert.equal(e.text(), original + "!");
  assert.equal(e.undo(), true);
  assert.equal(e.text(), original);
  assert.equal(e.redo(), true);
  assert.equal(e.text(), original + "!");
});
test("an exact agent replacement is one reversible edit and preserves the selection before it", () => {
  const e = editor("First\n\n__bold__\n\nLast");
  e.view.dispatch(e.view.state.tr.setSelection(proseState.TextSelection.create(e.view.state.doc, 2)));
  e.api.replace("First\n\n__bold__\n\nAI revised Last");
  assert.equal(e.view.state.selection.from, 2);
  assert.equal(e.text(), "First\n\n__bold__\n\nAI revised Last");
  e.undo();
  assert.equal(e.text(), "First\n\n__bold__\n\nLast");
  e.redo();
  assert.equal(e.text(), "First\n\n__bold__\n\nAI revised Last");
});
test("Markdown spelling-only edits also undo, without private nodes in the document", () => {
  const e = editor("__bold__");
  const before = e.view.state.doc.toJSON();
  e.api.replace("**bold**");
  assert.deepEqual(e.view.state.doc.toJSON(), before);
  assert.equal(e.text(), "**bold**");
  assert.equal(e.undo(), true);
  assert.equal(e.text(), "__bold__");
  e.redo(); assert.equal(e.text(), "**bold**");
});
test("multiple edits preserve unchanged middle blocks and duplicate paragraphs", () => {
  const original = "first\n\n__same__\n\n__same__\n\nlast\n";
  const e = editor(original);
  let tr = e.view.state.tr.insertText("!", 2);
  tr.insertText("?", tr.doc.content.size - 1);
  e.view.dispatch(tr);
  assert.equal(e.text(), "f!irst\n\n__same__\n\n__same__\n\nlast?\n");
});
test("input composition is not interrupted by a program edit", () => {
  const e = editor("中文");
  e.view.composing = true;
  assert.throws(() => e.api.replace("changed"), /输入法/);
  assert.equal(e.text(), "中文");
});
test("merge metadata follows text through one undo and redo event", () => {
  const contexts = [];
  const e = editor("before", (value) => contexts.push(value));
  e.api.replace("after", { before: "old-format", after: "merged-format" });
  assert.deepEqual(contexts, ["merged-format"]);
  e.undo(); assert.equal(e.text(), "before");
  assert.deepEqual(contexts, ["merged-format", "old-format"]);
  e.redo(); assert.equal(e.text(), "after");
  assert.deepEqual(contexts, ["merged-format", "old-format", "merged-format"]);
});
test("inserting and deleting whole blocks leaves surviving raw source untouched", () => {
  const original = "Title\n=====\n\n__same__\n\nlast";
  const e = editor(original);
  const lastAt = e.view.state.doc.content.size - e.view.state.doc.lastChild.nodeSize;
  e.view.dispatch(e.view.state.tr.insert(lastAt, schema.node("paragraph", null, schema.text("new"))));
  assert.equal(e.text(), "Title\n=====\n\n__same__\n\nnew\n\nlast");
  e.undo(); assert.equal(e.text(), original);
  const titleSize = e.view.state.doc.firstChild.nodeSize;
  e.view.dispatch(proseHistory.closeHistory(e.view.state.tr).delete(0, titleSize));
  assert.equal(e.text(), "\n\n__same__\n\nlast");
  e.undo(); assert.equal(e.text(), original);
});
test("sidecar restoration hydrates live table and paragraph decorations before observers run", () => {
  const { emptyDocumentFormatSettings, createFormatAnchor } = modules["./formatTypes"];
  const { formatRestoreKey } = modules["./editor/formatRestore"];
  const { createTableDecorationPlugin, tableDecorationPluginKey } = modules["./tableDecorations"];
  const { createTextLayoutPlugin, textLayoutPluginKey } = modules["./textLayout"];
  const before = emptyDocumentFormatSettings();
  const after = { ...before, defaults: { tableStyle: "three-line", firstLineIndent: true }, text: [{ anchor: createFormatAnchor(parse("body"), "text", 0), layout: { alignment: "center", firstLineIndent: true } }] };
  let e;
  const observed = [];
  e = editor("body", () => {
    observed.push([tableDecorationPluginKey.getState(e.view.state).defaultDecoration.threeLine, textLayoutPluginKey.getState(e.view.state).layouts[0]?.alignment]);
  }, (tr, context) => {
    const settings = JSON.parse(context);
    return tr.setMeta(formatRestoreKey, { settings, tableStyle: settings.defaults.tableStyle ?? "standard", firstLineIndent: settings.defaults.firstLineIndent ?? false });
  }, [createTableDecorationPlugin(before), createTextLayoutPlugin(before)]);
  e.api.replace("body", { before: JSON.stringify(before), after: JSON.stringify(after) });
  assert.deepEqual(observed, [[true, "center"]]);
  e.undo(); assert.deepEqual(observed, [[true, "center"], [false, undefined]]);
  e.redo(); assert.deepEqual(observed, [[true, "center"], [false, undefined], [true, "center"]]);
  assert.equal(e.text(), "body");
});
test("long-document undo stores only changed source ranges and replays grouped typing", () => {
  const original = "__untouched__\n\n" + "long body ".repeat(12000).trimEnd();
  const e = editor(original);
  for (const char of "abc") {
    e.view.dispatch(e.view.state.tr.insertText(char, e.view.state.doc.content.size - 1));
    const source = e.steps().find(step => step.toJSON().stepType === "hakurou-source");
    assert(JSON.stringify(source.toJSON()).length < 200);
  }
  assert.equal(e.text(), original + "abc");
  e.undo(); assert.equal(e.text(), original);
  e.redo(); assert.equal(e.text(), original + "abc");
});
test("generated heading attributes cannot suppress source undo or widen an agent replacement", () => {
  const normalizeHeading = new proseState.Plugin({ appendTransaction(_, _old, state) {
    if (state.doc.firstChild.type.name !== "heading" || state.doc.firstChild.attrs.id) return null;
    return state.tr.setNodeMarkup(0, undefined, { ...state.doc.firstChild.attrs, id: "generated-title" }).setMeta("addToHistory", false);
  } });
  const original = "Title\n=====\n\n__unchanged__\n\nlast";
  const e = editor(original, undefined, undefined, [normalizeHeading]);
  e.view.dispatch(e.view.state.tr);
  const heading = e.view.state.doc.firstChild;
  e.api.replace(original.replace("last", "AI last"));
  assert.equal(e.view.state.doc.firstChild, heading);
  e.undo(); assert.equal(e.text(), original);
  e.redo(); assert.equal(e.text(), original.replace("last", "AI last"));
  e.view.dispatch(e.view.state.tr.setNodeMarkup(0, undefined, { ...heading.attrs, id: "new-generated-id" }).setMeta("addToHistory", false));
  e.undo(); assert.equal(e.text(), original);
});
