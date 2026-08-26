import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorState } from "@milkdown/prose/state";

export type TextAlignment = "left" | "center" | "right";

export type TextLayoutSetting = {
  alignment: TextAlignment;
  firstLineIndent: boolean;
};

export type TableDecorationSetting = {
  titleRow: boolean;
  titleColumn: boolean;
  threeLine: boolean;
};

export type DocumentFontPreset = "elegant" | "modern" | "standard" | "custom";
export type DocumentFontWeight = 300 | 400 | 500 | 600 | 700;

export type DocumentFontSettings = {
  preset: DocumentFontPreset;
  weight: DocumentFontWeight;
  chineseFamily?: string;
  latinFamily?: string;
};

export type FormatTargetKind = "text" | "table";

export type FormatAnchor = {
  kind: FormatTargetKind;
  signature: string;
  occurrence: number;
  previous?: string;
  next?: string;
};

export type TextFormatEntry = {
  anchor: FormatAnchor;
  layout: TextLayoutSetting;
};

export type TableFormatEntry = {
  anchor: FormatAnchor;
  decoration: TableDecorationSetting;
};

export type DocumentFormatDefaults = {
  tableStyle?: "standard" | "three-line";
  font?: DocumentFontSettings;
  firstLineIndent?: boolean;
};

export type DocumentFormatSettings = {
  version: 1;
  documentFingerprint?: string;
  defaults: DocumentFormatDefaults;
  text: TextFormatEntry[];
  tables: TableFormatEntry[];
};

type AnchorCandidate = {
  position: number;
  signature: string;
  occurrence: number;
  previous?: string;
  next?: string;
};

const textAlignments = new Set<TextAlignment>(["left", "center", "right"]);

function hash(value: string) {
  let result = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 0x01000193);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}

function normalizedNodeContent(node: ProseNode) {
  const imageSources: string[] = [];
  node.descendants((child) => {
    if (child.type.name === "image") imageSources.push(String(child.attrs.src ?? ""));
  });
  return `${node.textContent.replace(/\s+/g, " ").trim()}|${imageSources.join("|")}`;
}

function nodeSignature(node: ProseNode) {
  const level = node.type.name === "heading" ? `:${node.attrs.level ?? ""}` : "";
  return `${node.type.name}${level}:${hash(normalizedNodeContent(node))}`;
}

function matchesKind(node: ProseNode, kind: FormatTargetKind) {
  return kind === "table"
    ? node.type.name === "table"
    : node.type.name === "paragraph" || node.type.name === "heading";
}

function candidatesFor(doc: ProseNode, kind: FormatTargetKind) {
  const raw: Array<{ position: number; signature: string }> = [];
  doc.descendants((node, position) => {
    if (matchesKind(node, kind)) raw.push({ position, signature: nodeSignature(node) });
  });
  const occurrences = new Map<string, number>();
  return raw.map((candidate, index) => {
    const occurrence = occurrences.get(candidate.signature) ?? 0;
    occurrences.set(candidate.signature, occurrence + 1);
    return {
      ...candidate,
      occurrence,
      previous: raw[index - 1]?.signature,
      next: raw[index + 1]?.signature,
    } satisfies AnchorCandidate;
  });
}

export function emptyDocumentFormatSettings(): DocumentFormatSettings {
  return { version: 1, defaults: {}, text: [], tables: [] };
}

export function documentContentFingerprint(markdown: string) {
  return hash(markdown.replace(/\r\n/g, "\n"));
}

export function createFormatAnchor(doc: ProseNode, kind: FormatTargetKind, position: number) {
  const candidate = candidatesFor(doc, kind).find((item) => item.position === position);
  if (!candidate) return null;
  const { position: _position, ...anchor } = candidate;
  return { kind, ...anchor } satisfies FormatAnchor;
}

export function resolveFormatAnchor(doc: ProseNode, anchor: FormatAnchor) {
  const candidates = candidatesFor(doc, anchor.kind).filter((item) => item.signature === anchor.signature);
  if (candidates.length === 1) return candidates[0]!.position;

  const scored = candidates.map((candidate) => ({
    candidate,
    score: (anchor.previous && candidate.previous === anchor.previous ? 4 : 0)
      + (anchor.next && candidate.next === anchor.next ? 4 : 0)
      + (candidate.occurrence === anchor.occurrence ? 1 : 0),
  }));
  const highestScore = Math.max(...scored.map((item) => item.score), 0);
  const best = scored.filter((item) => item.score === highestScore);
  return highestScore > 0 && best.length === 1 ? best[0]!.candidate.position : null;
}

export function parseDocumentFormatSettings(content: string | unknown): DocumentFormatSettings {
  try {
    const value = (typeof content === "string" ? JSON.parse(content) : content) as Partial<DocumentFormatSettings>;
    const text = Array.isArray(value.text) ? value.text.flatMap((entry) => {
      const layout = entry?.layout;
      const anchor = entry?.anchor;
      if (!isFormatAnchor(anchor, "text") || !textAlignments.has(layout?.alignment)) return [];
      return [{ anchor, layout: { alignment: layout.alignment, firstLineIndent: Boolean(layout.firstLineIndent) } }];
    }) : [];
    const tables = Array.isArray(value.tables) ? value.tables.flatMap((entry) => {
      const decoration = entry?.decoration;
      const anchor = entry?.anchor;
      if (!isFormatAnchor(anchor, "table") || !decoration) return [];
      return [{ anchor, decoration: {
        titleRow: decoration.titleRow !== false,
        titleColumn: Boolean(decoration.titleColumn),
        threeLine: Boolean(decoration.threeLine),
      } }];
    }) : [];
    return {
      version: 1,
      ...(typeof value.documentFingerprint === "string" ? { documentFingerprint: value.documentFingerprint } : {}),
      defaults: parseDocumentFormatDefaults(value.defaults),
      text,
      tables,
    };
  } catch {
    return emptyDocumentFormatSettings();
  }
}

function parseDocumentFormatDefaults(value: unknown): DocumentFormatDefaults {
  const defaults = value as Partial<DocumentFormatDefaults> | null;
  if (!defaults || typeof defaults !== "object") return {};
  const font = parseDocumentFontSettings(defaults.font);
  return {
    ...(defaults.tableStyle === "standard" || defaults.tableStyle === "three-line" ? { tableStyle: defaults.tableStyle } : {}),
    ...(font ? { font } : {}),
    ...(typeof defaults.firstLineIndent === "boolean" ? { firstLineIndent: defaults.firstLineIndent } : {}),
  };
}

function parseDocumentFontSettings(value: unknown): DocumentFontSettings | null {
  const font = value as Partial<DocumentFontSettings> | null;
  if (!font || typeof font !== "object") return null;
  if (font.preset !== "elegant" && font.preset !== "modern" && font.preset !== "standard" && font.preset !== "custom") return null;
  if (font.weight !== 300 && font.weight !== 400 && font.weight !== 500 && font.weight !== 600 && font.weight !== 700) return null;
  const chineseFamily = normalizeFontFamily(font.chineseFamily);
  const latinFamily = normalizeFontFamily(font.latinFamily);
  if (font.preset === "custom" && !chineseFamily && !latinFamily) return null;
  return {
    preset: font.preset,
    weight: font.weight,
    ...(chineseFamily ? { chineseFamily } : {}),
    ...(latinFamily ? { latinFamily } : {}),
  };
}

function normalizeFontFamily(value: unknown) {
  return typeof value === "string" ? value.replace(/[;{}]/g, "").trim().slice(0, 120) : "";
}

function isFormatAnchor(value: unknown, kind: FormatTargetKind): value is FormatAnchor {
  const anchor = value as Partial<FormatAnchor> | null;
  return Boolean(anchor
    && anchor.kind === kind
    && typeof anchor.signature === "string"
    && Number.isInteger(anchor.occurrence)
    && (anchor.previous === undefined || typeof anchor.previous === "string")
    && (anchor.next === undefined || typeof anchor.next === "string"));
}

function isLegacyMarkerBlock(node: ProseNode) {
  let marker = false;
  node.descendants((child) => {
    if (child.type.name !== "html") return;
    const value = String(child.attrs.value ?? "");
    if (/^<!--\s*hakurou-layout:align=(left|center|right)/.test(value) || value === "<!-- hakurou-table:three-line -->") marker = true;
  });
  return marker;
}

export function removeLegacyFormatMarkers(state: EditorState) {
  const markerPositions: number[] = [];
  state.doc.descendants((node, position) => {
    if (node.type.name === "paragraph" && isLegacyMarkerBlock(node)) markerPositions.push(position);
  });
  if (markerPositions.length === 0) return null;
  return markerPositions.reverse().reduce(
    (transaction, position) => transaction.delete(position, position + transaction.doc.nodeAt(position)!.nodeSize),
    state.tr,
  );
}
