import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/documentLinks.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(href, { button = 0, selected = false, failure = false, link = true } = {}) {
  const opened = [];
  const errors = [];
  class Element {
    closest() { return link ? anchor : null; }
  }
  const anchor = { getAttribute: () => href };
  const context = {
    exports: {}, URL, Element,
    window: { alert: (error) => errors.push(error) },
    require: () => ({ platform: { links: { async openExternal(url) {
      if (failure) throw new Error("Browser unavailable");
      opened.push(url);
    } } } }),
  };
  vm.runInNewContext(compiled, context);
  const event = {
    button,
    target: new Element(), // Also represents nested link content, such as <strong>.
    currentTarget: {
      contains: () => true,
      ownerDocument: { getSelection: () => ({ isCollapsed: !selected, anchorNode: anchor }) },
    },
    prevented: false,
    stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  context.exports.handleDocumentLinkClick(event);
  return { event, opened, errors };
}

test("clicking web links, including nested text and middle clicks, opens externally", () => {
  for (const button of [0, 1]) {
    const result = harness("https://example.com/paper?q=1#references", { button });
    assert.deepEqual(result.opened, ["https://example.com/paper?q=1#references"]);
    assert.equal(result.event.prevented, true);
    assert.equal(result.event.stopped, true);
  }
  assert.deepEqual(harness("//example.com/paper").opened, ["https://example.com/paper"]);
  assert.deepEqual(harness("HTTP://example.com").opened, ["http://example.com/"]);
  assert.deepEqual(harness("mailto:author@example.com").opened, ["mailto:author@example.com"]);
});

test("drag selection, right clicks and ordinary text do not launch a browser", () => {
  assert.deepEqual(harness("https://example.com", { selected: true }).opened, []);
  assert.deepEqual(harness("https://example.com", { button: 2 }).opened, []);
  const plain = harness("https://example.com", { link: false });
  assert.deepEqual(plain.opened, []);
  assert.equal(plain.event.prevented, false);
});

test("unsupported URLs never navigate the editor; local anchors keep their behavior", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,hello", "file:///C:/test.txt", "relative.md", ""]) {
    const result = harness(href);
    assert.deepEqual(result.opened, []);
    assert.equal(result.event.prevented, true);
  }
  const local = harness("#section");
  assert.deepEqual(local.opened, []);
  assert.equal(local.event.prevented, false);
});

test("an OS browser launch error is shown instead of becoming an unhandled rejection", async () => {
  const result = harness("https://example.com", { failure: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(result.errors, ["Error: Browser unavailable"]);
});
