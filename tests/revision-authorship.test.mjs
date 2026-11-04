import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/features/version-control/revisionAuthorship.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const { revisionAuthorship } = context.exports;
const text = { versionAuthorBy: (name) => `Changed by ${name}`, versionAuthorPending: "Uncommitted · Author not recorded", versionAuthorUnknown: "Author not recorded" };

test("historical changes use the compared commit author and never the email", () => {
  const author = revisionAuthorship({ kind: "version", authorName: " 小白 ", authorEmail: "private@example.invalid", timestamp: "2026-11-03T10:00:00Z" }, text);
  assert.equal(author.label, "Changed by 小白");
  assert.equal(author.timestamp, "2026-11-03T10:00:00Z");
  assert.equal(JSON.stringify(author).includes("private@example.invalid"), false);
});

test("uncommitted and external changes are not attributed to a saved nickname or older author", () => {
  for (const title of [undefined, "External disk version", "Local edits"]) {
    const author = revisionAuthorship({ kind: "currentDocument", title, authorName: "Previous author", timestamp: "2020-01-01" }, text);
    assert.equal(author.label, text.versionAuthorPending);
    assert.equal(author.timestamp, null);
  }
});

test("missing authors and empty baselines never invent an identity", () => {
  assert.equal(revisionAuthorship({ kind: "version", authorEmail: "private@example.invalid" }, text).label, text.versionAuthorUnknown);
  assert.equal(revisionAuthorship({ kind: "empty", authorName: "Someone" }, text), null);
});
