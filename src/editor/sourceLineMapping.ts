import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { Node as ProseNode } from "@milkdown/prose/model";

type SourceNode = {
  type: string;
  value?: string;
  children?: SourceNode[];
  position?: { start: { line: number }; end: { line: number } };
};
export type SourceBlock = { kind: string; text: string; start: number; end: number };
export type SourceLineAnchor = SourceBlock & { position: number; textblock: boolean };

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
const sourceKinds: Record<string, string> = {
  paragraph: "paragraph", heading: "heading", code: "code", math: "math",
  tableRow: "row", thematicBreak: "rule", html: "html",
};
const proseKinds: Record<string, string> = {
  paragraph: "paragraph", heading: "heading", code_block: "code", fence: "code",
  hakurou_block_formula: "math", table_row: "row", table_header_row: "row", hr: "rule", horizontal_rule: "rule",
  html: "html",
};

function sourceText(node: SourceNode): string {
  if (node.type === "image" || node.type === "imageReference") return "\ufffc";
  if (node.type === "break") return "\n";
  return node.value ?? (node.children ?? []).map(sourceText).join("");
}

function proseText(node: ProseNode): string {
  if (node.isText) return node.text ?? "";
  if (node.type.name === "image") return "\ufffc";
  if (node.type.name === "hardbreak" || node.type.name === "hard_break") return "\n";
  if (typeof node.attrs.value === "string") return node.attrs.value;
  let text = "";
  node.forEach((child) => { text += proseText(child); });
  return text;
}

function key(kind: string, text: string) {
  // Soft breaks, table cell padding and rendered whitespace may differ without
  // changing which source block the editor represents.
  return `${kind}\u0000${text.replace(/\s+/g, "")}`;
}

export function parseSourceBlocks(markdown: string): SourceBlock[] {
  const blocks: SourceBlock[] = [];
  const visit = (node: SourceNode) => {
    const kind = sourceKinds[node.type];
    if (kind && node.position) {
      blocks.push({ kind, text: sourceText(node), start: node.position.start.line, end: node.position.end.line });
      return;
    }
    node.children?.forEach(visit);
  };
  visit(processor.parse(markdown) as SourceNode);
  if (!markdown.trim()) blocks.push({ kind: "paragraph", text: "", start: 1, end: 1 });
  return blocks;
}

export function mapSourceLines(blocks: SourceBlock[], doc: ProseNode): SourceLineAnchor[] {
  const byContent = new Map<string, Array<{ block: SourceBlock; index: number }>>();
  blocks.forEach((block, index) => {
    const blockKey = key(block.kind, block.text);
    const matches = byContent.get(blockKey) ?? [];
    matches.push({ block, index });
    byContent.set(blockKey, matches);
  });
  const cursors = new Map<string, number>();
  const anchors: SourceLineAnchor[] = [];
  let previousIndex = -1;
  doc.descendants((node, position) => {
    const kind = proseKinds[node.type.name];
    if (!kind) return;
    const blockKey = key(kind, proseText(node));
    const matches = byContent.get(blockKey) ?? [];
    let cursor = cursors.get(blockKey) ?? 0;
    while (cursor < matches.length && matches[cursor]!.index <= previousIndex) cursor += 1;
    const match = matches[cursor];
    if (match) {
      anchors.push({ ...match.block, position, textblock: node.isTextblock });
      previousIndex = match.index;
      cursor += 1;
    }
    cursors.set(blockKey, cursor);
    // Table rows are one source line, irrespective of the number of cells.
    // Unmatched transient editor blocks must not shift subsequent line numbers.
    return false;
  });
  return anchors;
}
