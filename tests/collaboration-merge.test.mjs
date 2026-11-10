import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const modules = {};
for (const name of ["sequenceChanges", "merge"]) {
  const source = await readFile(new URL(`../src/collaboration/${name}.ts`, import.meta.url), "utf8");
  const context = { exports: {}, require: (name) => modules[name] };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  modules[`./${name}`] = context.exports;
}
const { mergeText, mergeResult, mergeMetadata } = modules["./merge"];
const merged = (base, local, disk, choices = {}) => mergeResult(mergeText(base, local, disk), choices);

test("independent human and external edits both survive, including CRLF and no final newline", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(merged("甲\r\n乙\r\n丙", "人改甲\r\n乙\r\n丙", "甲\r\n乙\r\nAI改丙"))), { text: "人改甲\r\n乙\r\nAI改丙", unresolved: 0 });
});
test("identical edits coalesce and only competing changes require decisions", () => {
  assert.equal(merged("a\nb\n", "a\nx\n", "a\nx\n").unresolved, 0);
  const regions = mergeText("a\nb\nc\n", "a\nmine\nc\n", "a\ntheirs\nc\n");
  const conflict = regions.find((region) => region.conflict);
  assert.ok(conflict);
  assert.equal(mergeResult(regions, {}).unresolved, 1);
  assert.equal(mergeResult(regions, { [conflict.id]: "disk" }).text, "a\ntheirs\nc\n");
  assert.equal(mergeResult(regions, { [conflict.id]: "both" }).text, "a\nmine\ntheirs\nc\n");
});
test("simultaneous insertion order and delete-versus-edit remain explicit", () => {
  assert.equal(merged("a\n", "x\na\n", "y\na\n").unresolved, 1);
  assert.equal(merged("a\nb\n", "a\n", "a\nc\n").unresolved, 1);
  assert.equal(merged("", "中文", "").text, "中文");
});
test("metadata fields merge independently; competing assets require an explicit side", () => {
  const base = { format: { font: "宋体", size: 12 }, assets: ["old"] };
  const local = { format: { font: "黑体", size: 12 }, assets: ["mine"] };
  const disk = { format: { font: "宋体", size: 14 }, assets: ["theirs"] };
  const result = mergeMetadata(base, local, disk);
  assert.equal(result.value.format.font, "黑体");
  assert.equal(result.value.format.size, 14);
  assert.equal(result.conflicts.length, 1);
  const decided = mergeMetadata(base, local, disk, { '["assets"]': "disk" });
  assert.equal(decided.conflicts.length, 0);
  assert.equal(decided.value.assets[0], "theirs");
});
test("large unrelated documents use a bounded conflict instead of quadratic allocation", () => {
  const base = Array.from({ length: 2000 }, (_, i) => `base${i}\n`).join("");
  assert.equal(merged(base, "mine\n".repeat(2000), "theirs\n".repeat(2000)).unresolved, 1);
});
