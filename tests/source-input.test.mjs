import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const context = { exports: {} };
const source = await readFile(new URL("../src/editor/sourceInput.ts", import.meta.url), "utf8");
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
const { sourceInputValue, applySourceInput } = context.exports;

test("merely displaying source preserves BOM, blank lines and mixed line endings", () => {
  const original = "\uFEFF# Title\r\n\r\n__bold__\n\nlast\r";
  assert.equal(sourceInputValue(original), "\uFEFF# Title\n\n__bold__\n\nlast\n");
  assert.equal(applySourceInput(original, sourceInputValue(original)), original);
});

test("source edits preserve the untouched mixed-ending prefix and suffix", () => {
  const original = "__first__\r\n\r\nsecond\n\nlast\r";
  assert.equal(applySourceInput(original, "__first__\n\nchanged second\n\nlast\n"), "__first__\r\n\r\nchanged second\n\nlast\r");
});

test("inserting prose between two code fences inherits the file's newline style", () => {
  const original = "```js\r\na()\r\n```\r\n\r\n```js\r\nb()\r\n```\r\n";
  const input = sourceInputValue(original).replace("```\n\n```js", "```\n\n两段代码之间的说明。\n\n```js");
  assert.equal(applySourceInput(original, input), input.replaceAll("\n", "\r\n"));
});

test("deleting or replacing across CRLF boundaries does not leave stray carriage returns", () => {
  assert.equal(applySourceInput("a\r\nb\r\nc", "ac"), "ac");
  assert.equal(applySourceInput("a\r\nb\r\nc", "a\n新段\nc"), "a\r\n新段\r\nc");
  assert.equal(applySourceInput("a\r\nb", ""), "");
});

test("start/end insertions and emoji edits retain exact surrounding source", () => {
  assert.equal(applySourceInput("", "中文\n😀"), "中文\n😀");
  assert.equal(applySourceInput("😀\r\n__last__", "😃\n__last__!\n"), "😃\r\n__last__!\r\n");
  assert.equal(applySourceInput("# title\r\n", "first\n# title\n"), "first\r\n# title\r\n");
});
