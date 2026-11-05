import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { valid } from "semver";

export function createUpdateManifest({ version, notes, signature, date = new Date().toISOString() }) {
  if (!valid(version) || valid(version) !== version) throw new Error("A normalized semantic version is required.");
  if (!signature?.trim()) throw new Error("The updater signature is required.");
  return {
    version, notes, pub_date: date,
    platforms: { "windows-x86_64": {
      signature: signature.trim(),
      url: `https://github.com/Hakur0uken/HakurouPaper/releases/download/v${version}/HakurouPaper_${version}_x64-setup.exe`,
    } },
  };
}
function signingKeyId(encoded) {
  const line = Buffer.from(encoded.trim(), "base64").toString("utf8").split(/\r?\n/)[1];
  const packet = Buffer.from(line ?? "", "base64");
  if (packet.length < 10) throw new Error("Invalid signature or public key encoding.");
  return packet.subarray(2, 10).toString("hex");
}
export async function writeUpdateManifest({ directory, version, notes, publicKey }) {
  const installerName = `HakurouPaper_${version}_x64-setup.exe`;
  const installer = await readFile(resolve(directory, installerName));
  if (installer.subarray(0, 2).toString() !== "MZ") throw new Error("Windows installer is missing or invalid.");
  const signature = await readFile(resolve(directory, installerName + ".sig"), "utf8");
  // Detect signing with the wrong local key before preparing the release.
  // Cryptographic verification is always performed by Tauri before installation.
  if (signingKeyId(signature) !== signingKeyId(publicKey)) throw new Error("Signing key does not match the application's updater public key.");
  const manifest = createUpdateManifest({ version, notes, signature });
  await writeFile(resolve(directory, "latest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  const names = [installerName, installerName + ".sig", "latest.json"];
  const checksums = await Promise.all(names.map(async (name) => createHash("sha256").update(await readFile(resolve(directory, name))).digest("hex") + "  " + name));
  await writeFile(resolve(directory, "SHA256SUMS.txt"), checksums.join("\n") + "\n", "utf8");
  return manifest;
}
