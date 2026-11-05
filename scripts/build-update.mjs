import { readFile, access } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { writeUpdateManifest } from "./update-manifest.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
if (process.platform !== "win32") throw new Error("This release helper currently builds Windows x64 installers.");
const env = { ...process.env };
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= "";
const key = option("--key");
if (key) { await access(resolve(key)); env.TAURI_SIGNING_PRIVATE_KEY = resolve(key); }
if (!env.TAURI_SIGNING_PRIVATE_KEY && !env.TAURI_SIGNING_PRIVATE_KEY_PATH) throw new Error("Set TAURI_SIGNING_PRIVATE_KEY or pass --key <private-key-path>. Never commit the key.");
const pkg = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const config = JSON.parse(await readFile(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
const cargo = await readFile(resolve(root, "src-tauri/Cargo.toml"), "utf8");
const cargoVersion = cargo.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
if (pkg.version !== config.version || pkg.version !== cargoVersion) throw new Error("Package, Cargo and Tauri versions must match.");
const cli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js");
await new Promise((done, reject) => {
  const build = spawn(process.execPath, [cli, "build", "--ci", "--bundles", "nsis"], { cwd: root, env, stdio: "inherit", windowsHide: true });
  build.on("error", reject);
  build.on("exit", (code) => code === 0 ? done() : reject(new Error("Tauri build failed.")));
});
const notesPath = option("--notes-file");
const notes = notesPath ? await readFile(resolve(notesPath), "utf8") : "";
const directory = resolve(root, "src-tauri/target/release/bundle/nsis");
await writeUpdateManifest({ directory, version: pkg.version, notes, publicKey: config.plugins.updater.pubkey });
console.log("Signed update files prepared in: " + directory);
console.log("Publish the installer, its .sig, latest.json and SHA256SUMS.txt together in a new GitHub Release.");
