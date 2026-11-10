import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

async function load(path, dependencies = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, require(name) { if (!(name in dependencies)) throw new Error(`Unknown dependency: ${name}`); return dependencies[name]; } };
  vm.runInNewContext(output, context);
  return context.exports;
}
const sequence = await load("../src/collaboration/sequenceChanges.ts");
const merge = await load("../src/collaboration/merge.ts", { "./sequenceChanges": sequence });
const { MergeResolutionEditor } = await load("../src/features/remote-sync/MergeResolutionEditor.tsx", { react: React, "react/jsx-runtime": jsx, "../../collaboration/merge": merge });
const { remoteMergeZh: text } = await load("../src/features/remote-sync/mergeText.ts");
const version = content => ({ kind: "text", content, mode: "100644" });
const conflict = { id: "one", paths: ["paper.md"], editable: true, reasons: [] };
function render(versions, options = {}) {
  return renderToStaticMarkup(React.createElement(MergeResolutionEditor, { versions, conflict, path: "paper.md", text, onChange() {}, ...options }));
}

test("text conflicts require an explicit choice and escape document markup", () => {
  const html = render({ base: version("base\n"), local: version("<script>local</script>\n"), remote: version("remote\n") });
  assert.match(html, /保留双方/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /disabled="">使用此合并结果/);
});
test("independent format fields merge without changing document or resource identity", () => {
  const base = { schemaVersion: 1, document: { documentId: "stable" }, assets: [{ assetId: "image" }], format: { defaults: { font: "serif", tableStyle: "normal" }, documentFingerprint: "old" } };
  const local = structuredClone(base); local.format.defaults.font = "modern"; local.format.documentFingerprint = "local";
  const remote = structuredClone(base); remote.format.defaults.tableStyle = "three-line"; remote.format.documentFingerprint = "remote";
  const html = render({ base: version(JSON.stringify(base)), local: version(JSON.stringify(local)), remote: version(JSON.stringify(remote)) }, { path: "assets/paper/hakurou.json" });
  for (const expected of ["modern", "three-line", "stable", "image"]) assert.ok(html.includes(expected));
  assert.doesNotMatch(html, /documentFingerprint|disabled="">使用此合并结果/);
});
test("unknown future metadata is handled as explicit source text", () => {
  const html = render({ base: version('{"schemaVersion":2,"setting":0}'), local: version('{"schemaVersion":2,"setting":1}'), remote: version('{"schemaVersion":2,"setting":2}') }, { path: "assets/paper/hakurou.json" });
  assert.ok(html.includes(text.invalidMetadata));
  assert.doesNotMatch(html, /<h3>格式与资源设置/);
});
test("binary, deletion and structural conflicts expose whole-side choices", () => {
  const sides = { base: { kind: "binary" }, local: { kind: "missing" }, remote: { kind: "binary" } };
  assert.match(render(sides), /删除文件/);
  assert.doesNotMatch(render(sides), /<textarea/);
  const html = render(sides, { conflict: { ...conflict, paths: ["old.md", "new.md"], editable: false } });
  assert.ok(html.includes(text.groupHelp));
  assert.match(html, /old\.md/); assert.match(html, /new\.md/);
  assert.doesNotMatch(html, /<textarea/);
});
