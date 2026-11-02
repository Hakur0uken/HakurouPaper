import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as unified from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Schema } from "@milkdown/prose/model";

const source = await readFile(new URL("../src/editor/sourceLineMapping.ts", import.meta.url), "utf8");
const modules = { unified, "remark-parse": { default: remarkParse }, "remark-gfm": { default: remarkGfm }, "remark-math": { default: remarkMath } };
const context = { exports: {}, require: (name) => modules[name] };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { parseSourceBlocks, mapSourceLines } = context.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));
const ranges = (blocks) => plain(blocks.map(({ start, end }) => [start, end]));
const schema = new Schema({ nodes: {
  doc: { content: "block+" }, text: { group: "inline" },
  paragraph: { group: "block", content: "inline*" },
  heading: { group: "block", content: "inline*" },
  blockquote: { group: "block", content: "block+" },
  bullet_list: { group: "block", content: "list_item+" },
  list_item: { content: "block+" },
  code_block: { group: "block", content: "text*" },
  hakurou_block_formula: { group: "block", atom: true, attrs: { value: {} } },
  hakurou_inline_formula: { group: "inline", inline: true, atom: true, attrs: { value: {} } },
  image: { group: "inline", inline: true, atom: true },
  table: { group: "block", content: "table_header_row table_row+" },
  table_header_row: { content: "table_cell+" },
  table_row: { content: "table_cell+" },
  table_cell: { content: "paragraph+" },
} });
const n = (name, children) => schema.node(name, null, children);
const p = (text = "") => n("paragraph", text ? schema.text(text) : []);

test("source ranges preserve blank lines, CRLF and multiline paragraphs", () => {
  const blocks = parseSourceBlocks("# Title\r\n\r\nFirst line\r\nsecond line\r\n\r\nLast");
  assert.deepEqual(ranges(blocks), [[1, 1], [3, 4], [6, 6]]);
  const doc = n("doc", [n("heading", schema.text("Title")), p("First line second line"), p("Last")]);
  assert.deepEqual(ranges(mapSourceLines(blocks, doc)), [[1, 1], [3, 4], [6, 6]]);
});

test("nested lists and quotes retain their individual source positions", () => {
  const markdown = "> quote\n\n- first\n  - nested\n- last";
  const doc = n("doc", [n("blockquote", [p("quote")]), n("bullet_list", [
    n("list_item", [p("first"), n("bullet_list", [n("list_item", [p("nested")])])]),
    n("list_item", [p("last")]),
  ])]);
  assert.deepEqual(ranges(mapSourceLines(parseSourceBlocks(markdown), doc)), [[1, 1], [3, 3], [4, 4], [5, 5]]);
});

test("table delimiter and reference definitions do not shift visible content", () => {
  const markdown = "[link]: https://example.com\n\n| A | B |\n|---|---|\n| C | D |\n\n[link][link]";
  const row = (a, b, kind = "table_row") => n(kind, [n("table_cell", [p(a)]), n("table_cell", [p(b)])]);
  const doc = n("doc", [n("table", [row("A", "B", "table_header_row"), row("C", "D")]), p("link")]);
  assert.deepEqual(ranges(mapSourceLines(parseSourceBlocks(markdown), doc)), [[3, 3], [5, 5], [7, 7]]);
});

test("code and formulas include their source delimiters; inline atoms map correctly", () => {
  const markdown = "```js\nx\ny\n```\n\n$$\nx+y\n$$\n\n![image](a.png) and $x$";
  const doc = n("doc", [n("code_block", schema.text("x\ny")),
    schema.node("hakurou_block_formula", { value: "x+y" }),
    n("paragraph", [n("image"), schema.text(" and "), schema.node("hakurou_inline_formula", { value: "x" })]),
  ]);
  assert.deepEqual(ranges(mapSourceLines(parseSourceBlocks(markdown), doc)), [[1, 4], [6, 8], [10, 10]]);
});

test("temporary empty paragraphs and repeated text do not consume the wrong source block", () => {
  const doc = n("doc", [p("same"), p(), p("same"), p("last")]);
  assert.deepEqual(ranges(mapSourceLines(parseSourceBlocks("same\n\nsame\n\nlast"), doc)), [[1, 1], [3, 3], [5, 5]]);
  assert.deepEqual(ranges(mapSourceLines(parseSourceBlocks(""), n("doc", [p()]))), [[1, 1]]);
});

test("inserting and deleting source lines updates all following numbers", () => {
  const before = n("doc", [p("first"), p("last")]);
  const after = n("doc", [p("first"), p("new"), p("last")]);
  assert.deepEqual(ranges(mapSourceLines(parseSourceBlocks("first\n\nlast"), before)), [[1, 1], [3, 3]]);
  assert.deepEqual(ranges(mapSourceLines(parseSourceBlocks("first\n\nnew\n\nlast"), after)), [[1, 1], [3, 3], [5, 5]]);
});
