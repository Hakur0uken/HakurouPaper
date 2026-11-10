import type { LiveEditor } from "../editor/sourceEditing";
import type { AgentRequest } from "../platform/agentTypes";
export type { AgentRequest, AgentEnvelope } from "../platform/agentTypes";

export type AgentDocument = { id: string; title: string; path: string | null; revision: string; dirty: boolean; active: boolean; externalChange: boolean; content: string };
export type AgentHost = { documents(): AgentDocument[]; editor(id: string): LiveEditor | undefined; busy(id: string): boolean; save(id: string): Promise<boolean> };
const fail = (message: string): never => { throw new Error(message); };
const pathKey = (value: string) => { const path = value.replace(/\\/g, "/"); return /^[A-Za-z]:\//.test(path) ? path.toLocaleLowerCase() : path; };
const boundary = (text: string, at: number) => !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]!) && /[\uDC00-\uDFFF]/.test(text[at]!));

export function applyTextEdits(content: string, edits: unknown): string {
  if (!Array.isArray(edits) || !edits.length || edits.length > 1000) return fail("edits must contain 1 to 1000 replacements");
  const sorted = edits.map((edit) => {
    if (!edit || !Number.isSafeInteger(edit.start) || !Number.isSafeInteger(edit.end) || typeof edit.text !== "string" || edit.start < 0 || edit.end < edit.start || edit.end > content.length || !boundary(content, edit.start) || !boundary(content, edit.end)) return fail("invalid text range; offsets use UTF-16 and must preserve complete Unicode characters");
    return edit as { start: number; end: number; text: string };
  }).sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start < sorted[i - 1]!.end || sorted[i]!.start === sorted[i - 1]!.start) fail("text ranges overlap or have ambiguous insertion order");
  let output = content;
  for (const edit of sorted.reverse()) output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  if (output.length > 4_000_000) fail("result exceeds the local editing limit");
  return output;
}

/** The same interface drives live local requests and tests; no filesystem edits here. */
export async function answerAgentRequest(host: AgentHost, request: AgentRequest): Promise<unknown> {
  if (!request || typeof request.action !== "string") return fail("invalid request");
  const documents = host.documents();
  if (request.action === "docs") return documents.map(({ content: _content, ...document }) => document);
  if (!["get", "replace", "apply", "save"].includes(request.action)) return fail("unknown action");
  if (typeof request.document !== "string") return fail("document id or absolute path is required");
  const document = documents.find((document) => document.id === request.document || (document.path && pathKey(document.path) === pathKey(request.document!)));
  if (!document) return fail("document is not open; use docs to find an open document id");
  if (request.action === "get") return document;
  if (!request.revision || request.revision !== document.revision) return fail("stale or missing revision; get the current document before editing or saving");
  if (document.externalChange) return fail("external changes need review or merging in HakurouPaper first");
  if (host.busy(document.id)) return fail("document is busy; finish the current save or dialog and read its revision again");
  if (request.action === "save") {
    if (!document.path) return fail("save this new document in HakurouPaper first");
    if (!await host.save(document.id)) return fail("document was not fully saved; review external changes or newer edits in HakurouPaper");
    return host.documents().find((current) => current.id === document.id);
  }
  const editor = host.editor(document.id);
  if (!editor) return fail("select this document's editing tab in HakurouPaper before editing it");
  let content: string, replacements = 0;
  if (request.action === "replace") {
    if (typeof request.find !== "string" || !request.find || typeof request.with !== "string") return fail("find must be non-empty and with must be a string");
    const edits = [];
    for (let at = document.content.indexOf(request.find); at !== -1; at = document.content.indexOf(request.find, at + request.find.length)) {
      edits.push({ start: at, end: at + request.find.length, text: request.with });
      if (edits.length > 1000) return fail("too many matches; narrow the requested replacement");
    }
    if (!edits.length) return fail("no exact match");
    if (edits.length > 1 && request.all !== true) return fail("multiple exact matches; use an explicit range or all=true");
    replacements = edits.length;
    content = applyTextEdits(document.content, edits);
  } else { content = applyTextEdits(document.content, request.edits); replacements = request.edits!.length; }
  if (editor.read() !== document.content) return fail("editor changed while preparing the request; get the current revision again");
  if (content !== document.content) editor.replace(content);
  const current = host.documents().find((current) => current.id === document.id);
  return { ...current, replacements };
}
