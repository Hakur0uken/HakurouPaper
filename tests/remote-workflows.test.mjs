import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

async function load(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {} };
  vm.runInNewContext(output, context);
  return context.exports;
}
const { uploadVersion, updateWorkingDirectory } = await load("../src/features/remote-sync/workflows.ts");
const { remoteSyncZh: text } = await load("../src/features/remote-sync/text.ts");
const remote = { name: "origin", fetchUrl: "https://gitee.com/example/paper.git", pushUrl: "https://gitee.com/example/paper.git", targetBranch: "main", accountId: "account-a", accountIssue: null };
const baseline = { repositoryRoot: "C:/paper", branch: "main", hasCommits: true, dirty: false, remotes: [remote], defaultRemote: "origin", stateToken: "before", changedPaths: [] };
const target = { repository: baseline, remote, createVersion: true };

test("create-and-upload saves a version before pushing and uses the new HEAD token", async () => {
  const order = [];
  let current = baseline;
  const result = await uploadVersion({
    async inspect() { return current; },
    async sync(input) { order.push("push"); assert.equal(input.stateToken, "after"); assert.equal(input.remote, "origin"); return current; },
  }, "C:/paper/paper.md", target, async () => { order.push("create"); current = { ...baseline, stateToken: "after" }; return true; }, text);
  assert.deepEqual(order, ["create", "push"]);
  assert.equal(result.stateToken, "after");
});

test("a cancelled or unsuccessful save never uploads", async () => {
  const service = { async inspect() { return baseline; }, async sync() { assert.fail("must not push"); } };
  assert.equal(await uploadVersion(service, "paper.md", target, async () => false, text), null);
});

test("an existing version can upload directly, including retry after a transport failure", async () => {
  const service = { async inspect() { return baseline; }, async sync() { return baseline; } };
  await uploadVersion(service, "paper.md", { ...target, createVersion: false }, async () => { assert.fail("must not create a duplicate"); }, text);
});

test("upload failure after commit explains that the local version is retained", async () => {
  let committed = false;
  const service = { async inspect() { return baseline; }, async sync() { throw new Error("network unavailable"); } };
  await assert.rejects(uploadVersion(service, "paper.md", target, async () => { committed = true; return true; }, text), /本地版本已创建[\s\S]*network unavailable/);
  assert.equal(committed, true);
});

test("stale confirmation and changed remote/account/branch never upload", async () => {
  for (const current of [
    { ...baseline, stateToken: "new-head" },
    { ...baseline, repositoryRoot: "C:/other" },
    { ...baseline, branch: "other" },
    { ...baseline, remotes: [{ ...remote, pushUrl: "https://github.com/example/other.git" }] },
    { ...baseline, remotes: [{ ...remote, accountId: "account-b" }] },
  ]) {
    await assert.rejects(uploadVersion({ async inspect() { return current; }, async sync() { assert.fail("must not push"); } }, "paper.md", target, async () => { assert.fail("must not create"); }, text), /重新确认/);
  }
});

test("a changed destination during commit is rejected while retaining the new local version", async () => {
  let committed = false;
  const service = { async inspect() { return committed ? { ...baseline, branch: "other" } : baseline; }, async sync() { assert.fail("must not push"); } };
  await assert.rejects(uploadVersion(service, "paper.md", target, async () => { committed = true; return true; }, text), /本地版本已创建[\s\S]*重新确认/);
});

test("menu pull uses the configured upstream instead of the first remote and returns changed paths", async () => {
  const repository = { ...baseline, defaultRemote: "team", remotes: [remote, { ...remote, name: "team", targetBranch: "writing" }] };
  const result = await updateWorkingDirectory({ async inspect() { return repository; }, async sync(input) { assert.equal(input.remote, "team"); assert.equal(input.action, "pull"); assert.equal(input.stateToken, "before"); return { ...repository, changedPaths: ["C:/paper/paper.md"] }; } }, "paper.md", () => false, text);
  assert.deepEqual(result.changedPaths, ["C:/paper/paper.md"]);
});

test("menu pull blocks ambiguous remotes, dirty files, missing account and unsaved edits", async () => {
  for (const repository of [
    { ...baseline, defaultRemote: null },
    { ...baseline, remotes: [] },
    { ...baseline, dirty: true },
    { ...baseline, branch: null },
    { ...baseline, hasCommits: false },
    { ...baseline, remotes: [{ ...remote, accountIssue: "choose an account" }] },
  ]) {
    await assert.rejects(updateWorkingDirectory({ async inspect() { return repository; }, async sync() { assert.fail("must not pull"); } }, "paper.md", () => false, text));
  }
  let inspected = false;
  const service = { async inspect() { inspected = true; return baseline; }, async sync() { assert.fail("must not pull"); } };
  await assert.rejects(updateWorkingDirectory(service, "paper.md", () => true, text), /保存/);
  assert.equal(inspected, false);
  await assert.rejects(updateWorkingDirectory(service, "paper.md", () => inspected, text), /保存/);
});
