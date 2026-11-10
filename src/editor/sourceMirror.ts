import type { Node as ProseNode } from "@milkdown/prose/model";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { sequenceChanges } from "../collaboration/sequenceChanges";

type Span = { start: number; end: number };
type SourceNode = { type: string; position?: { start: { offset: number }; end: { offset: number } } };
export type ParseMarkdown = (markdown: string) => ProseNode;
export type SerializeMarkdown = (doc: ProseNode) => string;
export type SourceSnapshot = { markdown: string; doc: ProseNode; spans: Span[] | null };
const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const signatures = new WeakMap<ProseNode, string>();
const children = (doc: ProseNode) => { const out: ProseNode[] = []; doc.forEach((node) => out.push(node)); return out; };
const body = (text: string) => text.replace(/(?:\r?\n)+$/, "");
function signature(node: ProseNode, doc: ProseNode, serialize: SerializeMarkdown) {
  let value = signatures.get(node);
  if (value === undefined) { value = body(serialize(doc.type.create(doc.attrs, [node]))); signatures.set(node, value); }
  return value;
}

/** Locate rendered top-level nodes in the original source, including reference context. */
function spansFor(markdown: string, doc: ProseNode, parse: ParseMarkdown, serialize: SerializeMarkdown): Span[] | null {
  const source = (processor.parse(markdown) as unknown as { children: SourceNode[] }).children;
  const definitions = source.filter((node) => node.type === "definition" && node.position)
    .map((node) => markdown.slice(node.position!.start.offset, node.position!.end.offset)).join("\n");
  const wanted = children(doc), spans: Span[] = [];
  let at = 0;
  for (const node of source) {
    if (node.type === "definition" || !node.position) continue;
    const span = { start: node.position.start.offset, end: node.position.end.offset };
    const raw = markdown.slice(span.start, span.end);
    const parsed = children(parse(raw + (definitions ? `\n\n${definitions}` : "")));
    if (parsed.length !== 1 || !wanted[at] || signature(parsed[0]!, doc, serialize) !== signature(wanted[at]!, doc, serialize)) return null;
    spans.push(span); at++;
  }
  // ProseMirror supplies one empty paragraph for an empty file.
  if (!at && wanted.length === 1 && !wanted[0]!.textContent && !markdown.trim()) return [{ start: markdown.length, end: markdown.length }];
  return at === wanted.length ? spans : null;
}

export function sourceSnapshot(markdown: string, doc: ProseNode, parse: ParseMarkdown, serialize: SerializeMarkdown): SourceSnapshot {
  return { markdown, doc, spans: spansFor(markdown, doc, parse, serialize) };
}

/** Keep unchanged editor nodes, including attributes absent from Markdown. */
export function reuseSourceNodes(previous: ProseNode, next: ProseNode, serialize: SerializeMarkdown): ProseNode {
  const oldNodes = children(previous), newNodes = children(next);
  const changes = sequenceChanges(oldNodes, newNodes, (a, b) => a.eq(b) || signature(a, next, serialize) === signature(b, next, serialize));
  const nodes: ProseNode[] = [];
  let at = 0;
  for (const change of changes) {
    while (at < change.from) nodes.push(oldNodes[at++]!);
    nodes.push(...change.insert); at = change.to;
  }
  while (at < oldNodes.length) nodes.push(oldNodes[at++]!);
  return next.type.create(next.attrs, nodes);
}

/** Reuse untouched source slices; serialize only the changed top-level ranges. */
export function rewriteSource(previous: SourceSnapshot, doc: ProseNode, parse: ParseMarkdown, serialize: SerializeMarkdown): SourceSnapshot {
  if (previous.doc.eq(doc)) return { ...previous, doc };
  const oldNodes = children(previous.doc), newNodes = children(doc);
  const changes = sequenceChanges(oldNodes, newNodes, (a, b) => a.eq(b) || signature(a, doc, serialize) === signature(b, doc, serialize));
  if (!changes.length) return { ...previous, doc };
  if (!previous.spans) {
    // Unmappable syntax remains usable. This is an explicit compatibility
    // fallback, not the normal path for supported Markdown blocks.
    return sourceSnapshot(serialize(doc), doc, parse, serialize);
  }
  const ending = previous.markdown.includes("\r\n") ? "\r\n" : "\n";
  const separator = ending + ending;
  const patches = changes.map((change) => {
    const from = change.from < previous.spans!.length ? previous.spans![change.from]!.start : previous.spans![previous.spans!.length - 1]?.end ?? previous.markdown.length;
    const to = change.to > change.from ? previous.spans![change.to - 1]!.end : from;
    const fragment = doc.type.create(doc.attrs, change.insert);
    let inserted = change.insert.length ? body(serialize(fragment)).replace(/\r?\n/g, ending) : "";
    if (change.from === change.to && inserted) inserted = change.from < oldNodes.length ? inserted + separator : separator + inserted;
    return { from, to, inserted, change };
  });
  let markdown = previous.markdown;
  for (const patch of [...patches].reverse()) markdown = markdown.slice(0, patch.from) + patch.inserted + markdown.slice(patch.to);
  // Range parsing is limited to this text's changed blocks during ordinary
  // input; an undo or exact external edit rebuilds its mapping once instead.
  const spans: Span[] = [];
  let oldAt = 0, shift = 0;
  for (const patch of patches) {
    while (oldAt < patch.change.from) {
      const old = previous.spans[oldAt++]!;
      spans.push({ start: old.start + shift, end: old.end + shift });
    }
    const insertedDoc = doc.type.create(doc.attrs, patch.change.insert);
    const found = patch.change.insert.length ? spansFor(patch.inserted, insertedDoc, parse, serialize) : [];
    if (!found) return sourceSnapshot(markdown, doc, parse, serialize);
    spans.push(...found.map((span) => ({ start: patch.from + shift + span.start, end: patch.from + shift + span.end })));
    oldAt = patch.change.to;
    shift += patch.inserted.length - (patch.to - patch.from);
  }
  while (oldAt < previous.spans.length) {
    const old = previous.spans[oldAt++]!;
    spans.push({ start: old.start + shift, end: old.end + shift });
  }
  return { markdown, doc, spans };
}
