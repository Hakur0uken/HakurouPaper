import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
const require = createRequire(import.meta.url);
async function load(path, imports = {}, globals = {}) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const context = { exports: {}, require: (name) => name in imports ? imports[name] : require(name), AbortSignal, ...globals };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const { SoftwareUpdateController } = await load("../src/features/software-update/controller.ts");
const releaseModule = await load("../src/features/software-update/release.ts");
const { parseLatestRelease } = releaseModule;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(overrides = {}) {
  const counts = { checks: 0, downloads: 0, installs: 0, closes: 0 };
  let block = null;
  const update = {
    version: "0.8.6", notes: "Example update", kind: "in-app",
    async download(progress) { counts.downloads++; progress({ downloaded: 5 }); progress({ downloaded: 10, total: 10 }); },
    async install() { counts.installs++; },
    async close() { counts.closes++; },
    ...overrides,
  };
  const service = { async check() { counts.checks++; return { currentVersion: "0.8.5", update }; }, async openReleasePage() {} };
  return { update, service, counts, controller: new SoftwareUpdateController(service, () => block), setBlock(value) { block = value; } };
}
test("startup is quiet when current or offline, while manual checks show a result", async () => {
  for (const fails of [false, true]) {
    const service = { async check() { if (fails) throw Error("offline"); return { currentVersion: "0.8.5", update: null }; } };
    const controller = new SoftwareUpdateController(service, () => null);
    await controller.check(false);
    assert.equal(controller.snapshot().open, false);
    assert.equal(controller.snapshot().phase, fails ? "error" : "current");
    await controller.check(true);
    assert.equal(controller.snapshot().open, true);
  }
});
test("startup finds an update; Later and manual checks reuse it without repeat requests", async () => {
  const f = fixture();
  await f.controller.check(false);
  assert.equal(f.controller.snapshot().open, true);
  f.controller.dismiss();
  assert.equal(f.controller.snapshot().open, false);
  await f.controller.check(true);
  assert.equal(f.counts.checks, 1);
  assert.equal(f.controller.snapshot().open, true);
});
test("manual check joins an in-flight startup check and dismissing it stays closed", async () => {
  const f = fixture(), pending = deferred();
  f.service.check = () => { f.counts.checks++; return pending.promise; };
  const first = f.controller.check(false);
  await f.controller.check(true);
  assert.equal(f.counts.checks, 1);
  assert.equal(f.controller.snapshot().open, true);
  f.controller.dismiss();
  pending.resolve({ currentVersion: "0.8.5", update: f.update });
  await first;
  assert.equal(f.controller.snapshot().open, false);
  assert.equal(f.controller.snapshot().phase, "available");
});
test("download updates progress, allows Later, and never starts installation by itself", async () => {
  const f = fixture();
  await f.controller.check(false);
  await f.controller.download();
  assert.equal(f.controller.snapshot().phase, "ready");
  assert.equal(f.controller.snapshot().downloaded, 10);
  assert.equal(f.counts.installs, 0);
  f.controller.dismiss();
  await f.controller.check(true);
  assert.equal(f.controller.snapshot().phase, "ready");
  assert.equal(f.counts.downloads, 1);
});
test("unsaved edits or repository activity block installation using live state", async () => {
  const f = fixture();
  await f.controller.check(true);
  await f.controller.download();
  for (const reason of ["unsaved", "busy"]) {
    f.setBlock(reason);
    await f.controller.install();
    assert.equal(f.counts.installs, 0);
    assert.equal(f.controller.snapshot().problem, reason);
  }
  f.setBlock(null);
  await f.controller.install();
  assert.equal(f.counts.installs, 1);
  f.controller.dismiss();
  assert.equal(f.controller.snapshot().open, true);
});
test("download or signature failure cannot enable installation; retry is possible", async () => {
  const f = fixture({ async download() { throw Error("Signature verification failed"); } });
  await f.controller.check(true);
  await f.controller.download();
  await f.controller.install();
  assert.equal(f.counts.installs, 0);
  assert.equal(f.controller.snapshot().phase, "available");
  assert.equal(f.controller.snapshot().problem, "download");
  f.update.download = async () => {};
  await f.controller.download();
  assert.equal(f.controller.snapshot().phase, "ready");
});
test("repeated actions do not duplicate downloads or installs", async () => {
  const gate = deferred();
  const f = fixture({ async download() { f.counts.downloads++; await gate.promise; } });
  await f.controller.check(true);
  const first = f.controller.download();
  await f.controller.download();
  await f.controller.install();
  assert.equal(f.counts.downloads, 1);
  assert.equal(f.counts.installs, 0);
  gate.resolve();
  await first;
  const install = deferred();
  f.update.install = async () => { f.counts.installs++; await install.promise; };
  const running = f.controller.install();
  await f.controller.install();
  assert.equal(f.counts.installs, 1);
  install.resolve();
  await running;
});
test("installation failure requires a fresh download, not a reused consumed installer", async () => {
  const f = fixture({ async install() { throw Error("Installer failed"); } });
  await f.controller.check(true);
  await f.controller.download();
  await f.controller.install();
  assert.equal(f.controller.snapshot().phase, "available");
  assert.equal(f.controller.snapshot().problem, "install");
});
test("manual legacy releases cannot run the installer", async () => {
  const f = fixture({ kind: "manual" });
  await f.controller.check(true);
  await f.controller.download();
  await f.controller.install();
  assert.equal(f.counts.downloads, 0);
  assert.equal(f.counts.installs, 0);
});
test("disposed checks release native resources without opening UI", async () => {
  const f = fixture(), gate = deferred();
  f.service.check = () => gate.promise;
  const pending = f.controller.check(false);
  f.controller.dispose();
  gate.resolve({ currentVersion: "0.8.5", update: f.update });
  await pending;
  assert.equal(f.counts.closes, 1);
  assert.equal(f.controller.snapshot().open, false);
});
const metadata = (version, assets = []) => ({ tag_name: version, body: "Release notes", draft: false, prerelease: false, assets });
test("release comparisons respect SemVer and do not downgrade or accept invalid metadata", () => {
  assert.equal(parseLatestRelease(metadata("v0.8.5"), "0.8.5"), null);
  assert.equal(parseLatestRelease(metadata("v0.8.4"), "0.8.5"), null);
  assert.equal(parseLatestRelease(metadata("v0.8.10"), "0.8.9").version, "0.8.10");
  assert.equal(parseLatestRelease(metadata("v1.0.0"), "1.0.0-beta.1").version, "1.0.0");
  for (const invalid of [null, {}, metadata("next"), { ...metadata("0.8.6"), draft: true }, { ...metadata("0.8.6"), prerelease: true }]) assert.throws(() => parseLatestRelease(invalid, "0.8.5"));
});
test("only a fully uploaded update manifest enables in-app updates", () => {
  assert.equal(parseLatestRelease(metadata("0.8.6"), "0.8.5").hasManifest, false);
  assert.equal(parseLatestRelease(metadata("0.8.6", [{ name: "latest.json", state: "starter" }]), "0.8.5").hasManifest, false);
  assert.equal(parseLatestRelease(metadata("0.8.6", [{ name: "latest.json", state: "uploaded" }]), "0.8.5").hasManifest, true);
});

test("release manifests bind signatures and version-specific installer addresses", async () => {
  const { createUpdateManifest } = await import("../scripts/update-manifest.mjs");
  const result = createUpdateManifest({ version: "0.8.6", notes: "Update", signature: "signed data\n", date: "2026-11-05T00:00:00Z" });
  assert.equal(result.platforms["windows-x86_64"].signature, "signed data");
  assert.equal(result.platforms["windows-x86_64"].url, "https://github.com/Hakur0uken/HakurouPaper/releases/download/v0.8.6/HakurouPaper_0.8.6_x64-setup.exe");
  for (const version of ["latest", "../0.8.6", "v0.8.6"]) assert.throws(() => createUpdateManifest({ version, signature: "signed" }));
  assert.throws(() => createUpdateManifest({ version: "0.8.6", signature: "" }));
});
async function adapter(metadata, native = undefined) {
  let checks = 0;
  let metadataFetches = 0;
  const { tauriUpdates } = await load("../src/platform/tauri/updates.ts", {
    "@tauri-apps/api/app": { getVersion: async () => "0.8.5" },
    "@tauri-apps/plugin-updater": { check: async () => { checks++; if (native === undefined) throw Error("Manifest unavailable"); return native; } },
    "@tauri-apps/plugin-process": { relaunch: async () => {} },
    "../../features/software-update/release": releaseModule,
    "./links": { tauriLinks: { openExternal: async () => {} } },
  }, { fetch: async () => { metadataFetches++; return { ok: true, json: async () => metadata }; } });
  return { service: tauriUpdates, checks: () => checks, metadataFetches: () => metadataFetches };
}
test("native adapter uses legacy metadata to distinguish current releases from manual updates", async () => {
  const current = await adapter(metadata("v0.8.5"));
  assert.equal((await current.service.check()).update, null);
  assert.equal(current.checks(), 1);
  const legacy = await adapter(metadata("v0.8.6"));
  const result = await legacy.service.check();
  assert.equal(result.update.kind, "manual");
  assert.equal(legacy.checks(), 1);
  await assert.rejects(result.update.install());
});
test("a successful native check avoids the rate-limited GitHub metadata API", async () => {
  for (const native of [null, { version: "0.8.6", body: "Update" }]) {
    const f = await adapter(null, native);
    const result = await f.service.check();
    assert.equal(result.update?.version ?? null, native?.version ?? null);
    assert.equal(f.metadataFetches(), 0);
  }
});
test("a failed published manifest remains an error and cannot downgrade to manual installation", async () => {
  const f = await adapter(metadata("0.8.6", [{ name: "latest.json", state: "uploaded" }]));
  await assert.rejects(f.service.check(), /Signed update check failed/);
});
test("a mismatched signed manifest is released and cannot be offered for installation", async () => {
  let closed = 0;
  const f = await adapter(metadata("v0.8.6", [{ name: "latest.json", state: "uploaded" }]), { version: "0.8.4", close: async () => { closed++; } });
  await assert.rejects(f.service.check());
  assert.equal(closed, 1);
});
test("native download adapter reports byte progress and does not install during download", async () => {
  let installed = 0;
  const native = {
    version: "0.8.6", body: "Update",
    download: async (progress) => { progress({ event: "Started", data: { contentLength: 100 } }); progress({ event: "Progress", data: { chunkLength: 40 } }); progress({ event: "Finished" }); },
    install: async () => { installed++; }, close: async () => {},
  };
  const f = await adapter(metadata("0.8.6", [{ name: "latest.json", state: "uploaded" }]), native);
  const { update } = await f.service.check();
  const progress = [];
  await update.download((p) => progress.push(p));
  assert.equal(progress.at(-1).downloaded, 40);
  assert.equal(progress.at(-1).total, 100);
  assert.equal(installed, 0);
  await update.install();
  assert.equal(installed, 1);
});
