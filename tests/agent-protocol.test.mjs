import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { requestAgent } from "../scripts/hakurou-agent.mjs";
const source = await readFile(new URL("../src/collaboration/agentProtocol.ts", import.meta.url), "utf8");
const context = { exports: {}, require: () => ({}) };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { answerAgentRequest, applyTextEdits } = context.exports;
function host() {
  let content = "人正在写作。\n\nAI 可修改这一段。", revision = 0, saved = 0, changes = 0;
  const document = () => ({ id: "doc", title: "论文", path: "C:/论文/paper.md", revision: `doc:${revision}`, dirty: revision > saved, active: true, externalChange: false, content });
  return { documents: () => [document()], busy: () => false,
    editor: () => ({ read: () => content, replace(text) { content = text; revision++; changes++; } }),
    async save() { saved = revision; return true; }, get changes() { return changes; } };
}
test("read includes unsaved edits; writing is revision-checked and never implicitly saves", async () => {
  const h = host();
  const before = await answerAgentRequest(h, { action: "get", document: "doc" });
  const after = await answerAgentRequest(h, { action: "replace", document: "doc", revision: before.revision, find: "这一段", with: "最后一段" });
  assert.equal(after.dirty, true); assert.equal(h.changes, 1);
  assert.match(after.content, /最后一段/);
  await assert.rejects(answerAgentRequest(h, { action: "replace", document: "doc", revision: before.revision, find: "AI", with: "人" }), /revision/);
  assert.equal(h.changes, 1);
  const saved = await answerAgentRequest(h, { action: "save", document: "doc", revision: after.revision });
  assert.equal(saved.dirty, false);
});
test("scope, ambiguous matches and external conflicts reject without changing the editor", async () => {
  const h = host();
  await assert.rejects(answerAgentRequest(h, { action: "get", document: "not-open.md" }), /not open/);
  await assert.rejects(answerAgentRequest(h, { action: "replace", document: "doc", revision: "doc:0", find: "。", with: "！" }), /multiple/);
  assert.equal(h.changes, 0);
  await answerAgentRequest(h, { action: "replace", document: "doc", revision: "doc:0", find: "。", with: "！", all: true });
  assert.equal(h.changes, 1);
  h.documents = () => [{ id: "doc", revision: "doc:1", externalChange: true }];
  await assert.rejects(answerAgentRequest(h, { action: "apply", document: "doc", revision: "doc:1", edits: [{ start: 0, end: 0, text: "x" }] }), /external/);
});
test("patch ranges handle Chinese and emoji without splitting characters or overlapping", () => {
  assert.equal(applyTextEdits("中文😀 end", [{ start: 0, end: 1, text: "英" }, { start: 2, end: 4, text: "😊" }]), "英文😊 end");
  assert.throws(() => applyTextEdits("中文😀", [{ start: 3, end: 4, text: "x" }]), /Unicode/);
  assert.throws(() => applyTextEdits("abcd", [{ start: 0, end: 3, text: "x" }, { start: 2, end: 4, text: "y" }]), /overlap/);
});
test("CLI transport authenticates a loopback request and decodes Unicode across TCP chunks", async () => {
  const dir = await mkdtemp(join(tmpdir(), "hakurou-agent-test-"));
  const server = createServer((socket) => {
    let input = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      input += chunk; if (!input.includes("\n")) return;
      const wire = JSON.parse(input);
      assert.equal(wire.token, "only-test-token");
      assert.equal(wire.request.action, "get");
      const reply = Buffer.from(JSON.stringify({ result: { content: "中文😀", revision: "doc:5" } }) + "\n");
      socket.write(reply.subarray(0, 24)); socket.end(reply.subarray(24));
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const path = join(dir, "connection.json");
    await writeFile(path, JSON.stringify({ version: 1, port: server.address().port, token: "only-test-token" }));
    const result = await requestAgent({ action: "get", document: "doc" }, path);
    assert.deepEqual(result, { content: "中文😀", revision: "doc:5" });
  } finally { await new Promise((resolve) => server.close(resolve)); await rm(dir, { recursive: true }); }
});
