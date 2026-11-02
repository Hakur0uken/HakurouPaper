import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/platform/tauri/files.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(initialPaths = []) {
  let pending = [...initialPaths];
  const callbacks = new Set();
  let subscribed = false;
  const context = {
    exports: {},
    console,
    require(name) {
      if (name === "@tauri-apps/api/core") return {
        async invoke(command) {
          assert.equal(command, "take_open_markdown_requests");
          assert.equal(subscribed, true, "subscribe before draining startup paths");
          const paths = pending;
          pending = [];
          return paths;
        },
      };
      if (name === "@tauri-apps/api/event") return {
        async listen(event, callback) {
          assert.equal(event, "open-markdown-requested");
          subscribed = true;
          callbacks.add(callback);
          return () => callbacks.delete(callback);
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  return {
    files: context.exports.tauriFiles,
    launch(...paths) {
      pending.push(...paths);
      callbacks.forEach((callback) => callback());
    },
    get listeners() { return callbacks.size; },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

test("cold start and a second launch during loading open every file in order", async () => {
  const app = harness(["C:/论文/English paper.MD", "C:/论文/second.md"]);
  const opened = [];
  let finishFirst;
  const firstLoad = new Promise((resolve) => { finishFirst = resolve; });
  let ready = false;
  const subscription = app.files.onOpenMarkdownRequested(async (path) => {
    opened.push(path);
    if (opened.length === 1) await firstLoad;
  }).then((cleanup) => {
    ready = true;
    return cleanup;
  });
  await flush();
  app.launch("C:/论文/third.markdown");
  app.launch("C:/论文/fourth.mdx");
  assert.deepEqual(opened, ["C:/论文/English paper.MD"]);
  assert.equal(ready, false, "the workspace must not show its welcome document while startup I/O is pending");
  finishFirst();
  const cleanup = await subscription;
  await flush();
  assert.deepEqual(opened, ["C:/论文/English paper.MD", "C:/论文/second.md", "C:/论文/third.markdown", "C:/论文/fourth.mdx"]);
  cleanup();
  assert.equal(app.listeners, 0);
});

test("launching without a file becomes ready without opening a document", async () => {
  const app = harness();
  const opened = [];
  const cleanup = await app.files.onOpenMarkdownRequested(async (path) => { opened.push(path); });
  assert.deepEqual(opened, []);
  assert.equal(app.listeners, 1);
  cleanup();
});

test("startup readiness waits for every file, including the final slow document", async () => {
  const app = harness(["first.md", "last.md"]);
  let finishLast;
  const lastLoad = new Promise((resolve) => { finishLast = resolve; });
  const opened = [];
  let ready = false;
  const subscription = app.files.onOpenMarkdownRequested(async (path) => {
    opened.push(path);
    if (path === "last.md") await lastLoad;
  }).then((cleanup) => { ready = true; return cleanup; });
  await flush();
  assert.deepEqual(opened, ["first.md", "last.md"]);
  assert.equal(ready, false);
  finishLast();
  const cleanup = await subscription;
  assert.equal(ready, true);
  cleanup();
});

test("subscription cleanup and remount neither lose nor repeat queued paths", async () => {
  const app = harness(["startup.md"]);
  const opened = [];
  const cleanup = await app.files.onOpenMarkdownRequested(async (path) => { opened.push(path); });
  cleanup();
  app.launch("after-cleanup.md");
  const cleanupAgain = await app.files.onOpenMarkdownRequested(async (path) => { opened.push(path); });
  await flush();
  assert.deepEqual(opened, ["startup.md", "after-cleanup.md"]);
  cleanupAgain();
  assert.equal(app.listeners, 0);
});
