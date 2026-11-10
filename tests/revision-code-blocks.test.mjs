import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { Schema } from "@milkdown/prose/model";
import * as state from "@milkdown/prose/state";
import * as view from "@milkdown/prose/view";

async function load(file, modules = {}) {
  const source = await readFile(new URL(`../src/${file}.ts`, import.meta.url), "utf8");
  const context = { exports: {}, require: name => modules[name] };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return context.exports;
}
const { computeLightweightRevisionLocations } = await load("features/version-control/lightweightRevisionDiff");
const { createRevisionDecorationPlugin, revisionDecorationPluginKey, setRevisionDecorations } = await load("revisionDecorations", {
  "@milkdown/utils": { $prose: factory => factory() }, "@milkdown/prose/state": state, "@milkdown/prose/view": view,
});
const schema = new Schema({ nodes: {
  doc: { content: "block+" }, text: { group: "inline" },
  paragraph: { group: "block", content: "inline*" },
  code_block: { group: "block", content: "text*" },
  hakurou_block_formula: { group: "block", atom: true },
} });

for (const [label, formula] of [["multiline dollar", "$$\nx=1\n$$"], ["multiline bracket", "\\[\nx=1\n\\]"], ["single-line", "$$x=1$$"], ["blank lines inside", "$$\n\nx=1\n\n$$"]]) {
  test(`code markers stay on the correct blocks after ${label} math`, () => {
    const before = `${formula}\n\n\x60\x60\x60js\nfirst();\n\x60\x60\x60\n\n\x60\x60\x60js\nsecond();\n\x60\x60\x60\n`;
    const after = before.replace("first();", "changed();") + "\n\x60\x60\x60js\nnewCode();\n\x60\x60\x60\n";
    const locations = computeLightweightRevisionLocations({ beforeMarkdown: before, afterMarkdown: after, beforeAssetPaths: [], afterAssetPaths: [] });
    assert.deepEqual(Array.from(locations, location => [location.kind, location.anchorAfter.blockIndex]), [["modified", 1], ["added", 3]]);
    const code = value => schema.node("code_block", null, schema.text(value));
    const doc = schema.node("doc", null, [schema.node("hakurou_block_formula"), code("changed();"), code("second();"), code("newCode();")]);
    const plugin = createRevisionDecorationPlugin(() => {});
    let current = state.EditorState.create({ doc, plugins: [plugin] });
    current = current.apply(current.tr.setMeta(revisionDecorationPluginKey, setRevisionDecorations(true, locations, "base")));
    const positions = [];
    doc.forEach((node, position, index) => { if (index === 1 || index === 3) positions.push(position); });
    assert.deepEqual(Array.from(revisionDecorationPluginKey.getState(current).decorations.find(), decoration => decoration.from), positions);
  });
}
