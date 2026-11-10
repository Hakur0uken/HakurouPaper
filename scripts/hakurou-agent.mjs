#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";
import { createConnection } from "node:net";
import { pathToFileURL } from "node:url";

export function defaultConnectionPath() {
  const root = process.platform === "win32" ? process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local")
    : process.platform === "darwin" ? join(homedir(), "Library", "Application Support")
    : process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(root, "com.hakurou.paper", "agent-connection.json");
}

export async function requestAgent(request, connectionPath = process.env.HAKUROU_AGENT_CONNECTION ?? defaultConnectionPath()) {
  let connection;
  try { connection = JSON.parse(await readFile(connectionPath, "utf8")); }
  catch { throw new Error("HakurouPaper local connection is unavailable. Start the updated app first, or set HAKUROU_AGENT_CONNECTION."); }
  if (connection.version !== 1 || !Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535 || typeof connection.token !== "string") throw new Error("Invalid local connection file");
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: connection.port });
    let output = "", bytes = 0;
    socket.setEncoding("utf8"); socket.setTimeout(35_000);
    socket.once("connect", () => socket.write(JSON.stringify({ token: connection.token, request }) + "\n"));
    socket.on("data", (chunk) => {
      bytes += Buffer.byteLength(chunk); output += chunk;
      if (bytes > 32 * 1024 * 1024) { socket.destroy(); reject(new Error("Local response exceeds the size limit")); return; }
      const end = output.indexOf("\n");
      if (end < 0) return;
      socket.destroy();
      try { const response = JSON.parse(output.slice(0, end)); if (response.error) reject(new Error(response.error)); else resolve(response.result); }
      catch (error) { reject(error); }
    });
    socket.once("timeout", () => { socket.destroy(); reject(new Error("Request timed out; get the current document before retrying an edit")); });
    socket.once("error", () => reject(new Error("Cannot reach the running HakurouPaper app. Restart it and read the document again.")));
    socket.once("end", () => { if (!output.includes("\n")) reject(new Error("Local connection ended before a response arrived")); });
  });
}

const usage = `HakurouPaper local editing (Node.js 18+; app must be running)
  node scripts/hakurou-agent.mjs docs
  node scripts/hakurou-agent.mjs get FILE_OR_DOCUMENT_ID
  node scripts/hakurou-agent.mjs replace FILE_OR_DOCUMENT_ID FIND WITH --revision TOKEN [--all]
  node scripts/hakurou-agent.mjs apply FILE_OR_DOCUMENT_ID PATCH.json --revision TOKEN
  node scripts/hakurou-agent.mjs save FILE_OR_DOCUMENT_ID --revision TOKEN

get returns current Markdown, including unsaved input, and an opaque revision token.
apply reads an array of {start,end,text} edits with UTF-16 offsets from that snapshot.
Edits enter the app's undo history. They do not save or create a Git version.
Use the returned revision token for the next edit or explicit save.
Optional: --connection FILE, or HAKUROU_AGENT_CONNECTION, selects another app instance.`;

export async function cli(args) {
  if (!args.length || args.includes("--help") || args.includes("-h")) return usage;
  const words = [...args];
  const option = (name) => {
    const at = words.indexOf(name); if (at < 0) return undefined;
    if (at === words.length - 1) throw new Error(`${name} requires a value`);
    const value = words[at + 1]; words.splice(at, 2); return value;
  };
  const connection = option("--connection"), revision = option("--revision");
  const allAt = words.indexOf("--all"), all = allAt >= 0;
  if (all) words.splice(allAt, 1);
  const [action, named, ...rest] = words;
  const document = named && (/^[\w-]+:\d+$/.test(named) || /^[0-9a-f-]{36}$/i.test(named) ? named : resolve(named));
  let request;
  if (action === "docs" && words.length === 1) request = { action };
  else if (action === "get" && words.length === 2) request = { action, document };
  else if (action === "save" && words.length === 2 && revision) request = { action, document, revision };
  else if (action === "replace" && rest.length === 2 && revision) request = { action, document, revision, find: rest[0], with: rest[1], all };
  else if (action === "apply" && rest.length === 1 && revision) request = { action, document, revision, edits: JSON.parse(await readFile(rest[0], "utf8")) };
  else throw new Error(usage);
  return JSON.stringify(await requestAgent(request, connection), null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  cli(process.argv.slice(2)).then((output) => console.log(output)).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
