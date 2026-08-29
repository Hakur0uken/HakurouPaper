import type { RevisionBlockAnchor, RevisionLocation } from "./revisionTypes";

type LightweightBlock = {
  kind: string;
  text: string;
  signature: string;
  similarityText: string;
  index: number;
  headingPath: string[];
  imageUrl?: string;
};

type LightweightChange = {
  id: string;
  kind: RevisionLocation["kind"] | "unchanged";
  before?: LightweightBlock;
  after?: LightweightBlock;
};

export type LightweightRevisionDiffInput = {
  beforeMarkdown: string;
  afterMarkdown: string;
  beforeMetadata?: string;
  afterMetadata?: string;
  beforeAssetPaths: string[];
  afterAssetPaths: string[];
};

function normalise(value: string) {
  return value.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function visibleText(value: string) {
  return value
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\\([\\`*_[\]{}()#+\-.!])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function imageUrl(value: string) {
  return value.match(/!\[[^\]]*\]\(([^\s)]+)(?:\s+[^)]*)?\)/)?.[1];
}

function block(kind: string, source: string, index: number): LightweightBlock {
  const image = imageUrl(source);
  const text = visibleText(source);
  const signatureText = normalise(source);
  return {
    kind,
    text,
    signature: `${kind}:${signatureText}${image ? `:image:${normalise(image)}` : ""}`,
    similarityText: normalise(text),
    index,
    headingPath: [],
    ...(image ? { imageUrl: image } : {}),
  };
}

function isHeading(line: string) {
  return /^(#{1,6})\s+/.test(line);
}

function isFence(line: string) {
  return /^\s*(`{3,}|~{3,})/.test(line);
}

function isList(line: string) {
  return /^\s*(?:[-+*]|\d+[.)])\s+/.test(line);
}

function isHorizontalRule(line: string) {
  return /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

function isMathStart(line: string) {
  return /^\s*(?:\$\$|\\\[)/.test(line);
}

function isTableStart(lines: string[], index: number) {
  return lines[index]!.includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] ?? "");
}

function startsBlock(lines: string[], index: number) {
  const line = lines[index] ?? "";
  return !line.trim() || isHeading(line) || isFence(line) || isList(line) || /^\s*>/.test(line) || isHorizontalRule(line) || isMathStart(line) || isTableStart(lines, index);
}

function trailingEmptyParagraphCount(markdown: string) {
  const normalisedMarkdown = markdown.replace(/\r\n?/g, "\n");
  const trailingNewlines = normalisedMarkdown.match(/\n+$/)?.[0].length ?? 0;
  if (!normalisedMarkdown.trim()) {
    // A ProseMirror document always has one paragraph, even though a single
    // empty paragraph serialises as an empty Markdown string.
    return Math.floor(trailingNewlines / 2) + 1;
  }
  // remark-stringify ends ordinary content with one newline. Every additional
  // empty trailing paragraph contributes a second newline, so preserve it as
  // a real block for the lightweight editor diff.
  return Math.floor(trailingNewlines / 2);
}

/** A deliberately small Markdown block parser used only for editor decorations. */
function parseBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: LightweightBlock[] = [];
  let lineIndex = 0;
  const append = (kind: string, source: string) => blocks.push(block(kind, source, blocks.length));
  while (lineIndex < lines.length) {
    const line = lines[lineIndex] ?? "";
    const trimmed = line.trim();
    if (!trimmed) {
      lineIndex += 1;
      continue;
    }
    if (isHeading(line)) {
      append("heading", line);
      lineIndex += 1;
      continue;
    }
    if (isHorizontalRule(line)) {
      append("horizontalRule", line);
      lineIndex += 1;
      continue;
    }
    if (isFence(line)) {
      const fence = line.match(/^\s*(`{3,}|~{3,})/)?.[1] ?? "```";
      const group = [line];
      lineIndex += 1;
      while (lineIndex < lines.length) {
        const current = lines[lineIndex++]!;
        group.push(current);
        if (new RegExp(`^\\s*${fence[0]}{${fence.length},}`).test(current)) break;
      }
      append("code", group.join("\n"));
      continue;
    }
    if (isMathStart(line)) {
      const closing = line.includes("\\[") ? "\\]" : "$$";
      const group = [line];
      lineIndex += 1;
      while (lineIndex < lines.length && !(group[group.length - 1] ?? "").includes(closing)) group.push(lines[lineIndex++]!);
      append("math", group.join("\n"));
      continue;
    }
    if (isTableStart(lines, lineIndex)) {
      const group: string[] = [];
      while (lineIndex < lines.length && (lines[lineIndex] ?? "").includes("|")) group.push(lines[lineIndex++]!);
      append("table", group.join("\n"));
      continue;
    }
    if (isList(line)) {
      const group: string[] = [];
      while (lineIndex < lines.length) {
        const current = lines[lineIndex] ?? "";
        if (!current.trim()) {
          group.push(current);
          lineIndex += 1;
          continue;
        }
        if (!isList(current) && !/^\s+/.test(current)) break;
        group.push(current);
        lineIndex += 1;
      }
      append("list", group.join("\n"));
      continue;
    }
    if (/^\s*>/.test(line)) {
      const group: string[] = [];
      while (lineIndex < lines.length && /^\s*>/.test(lines[lineIndex] ?? "")) group.push(lines[lineIndex++]!);
      append("blockquote", group.join("\n"));
      continue;
    }
    const group: string[] = [];
    while (lineIndex < lines.length && !startsBlock(lines, lineIndex)) group.push(lines[lineIndex++]!);
    const source = group.join("\n");
    append(imageUrl(source) && source.trim().match(/^!\[[^\]]*\]\([^)]*\)$/) ? "image" : "paragraph", source);
  }
  for (let emptyIndex = 0; emptyIndex < trailingEmptyParagraphCount(markdown); emptyIndex += 1) append("paragraph", "");
  const headings: string[] = [];
  blocks.forEach((item) => {
    if (item.kind === "heading") {
      const depth = Math.max(1, (item.text.match(/^(#+)/)?.[1]?.length ?? 1));
      // The visible text no longer contains the Markdown heading marker, so read depth from its signature source.
      const signatureDepth = Number(item.signature.match(/^heading:(#{1,6})/)?.[1]?.length ?? depth);
      headings.length = signatureDepth - 1;
      headings[signatureDepth - 1] = item.text || "章节";
    }
    item.headingPath = headings.filter(Boolean);
  });
  return blocks;
}

function pairExactSignatures(before: LightweightBlock[], after: LightweightBlock[]) {
  const beforeSignatures = before.map((item) => item.signature);
  const afterSignatures = after.map((item) => item.signature);
  if (before.length * after.length > 160_000) {
    const positions = new Map<string, number[]>();
    afterSignatures.forEach((signature, index) => {
      const candidates = positions.get(signature);
      if (candidates) candidates.push(index);
      else positions.set(signature, [index]);
    });
    const pairs: Array<[number, number]> = [];
    let afterCursor = 0;
    beforeSignatures.forEach((signature, beforeIndex) => {
      const match = (positions.get(signature) ?? []).find((index) => index >= afterCursor);
      if (match === undefined) return;
      pairs.push([beforeIndex, match]);
      afterCursor = match + 1;
    });
    return pairs;
  }
  const width = after.length + 1;
  const matrix = new Uint32Array((before.length + 1) * width);
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const cell = beforeIndex * width + afterIndex;
      matrix[cell] = beforeSignatures[beforeIndex] === afterSignatures[afterIndex]
        ? matrix[(beforeIndex + 1) * width + afterIndex + 1]! + 1
        : Math.max(matrix[(beforeIndex + 1) * width + afterIndex]!, matrix[beforeIndex * width + afterIndex + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (beforeSignatures[beforeIndex] === afterSignatures[afterIndex]) {
      pairs.push([beforeIndex++, afterIndex++]);
    } else if (matrix[(beforeIndex + 1) * width + afterIndex]! >= matrix[beforeIndex * width + afterIndex + 1]!) {
      beforeIndex += 1;
    } else {
      afterIndex += 1;
    }
  }
  return pairs;
}

function textSimilarity(left: string, right: string) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  const fragments = (value: string) => Array.from(value.length < 3 ? value : value.match(/.{1,2}/g) ?? []);
  const leftFragments = new Set(fragments(left));
  const rightFragments = new Set(fragments(right));
  let common = 0;
  leftFragments.forEach((fragment) => { if (rightFragments.has(fragment)) common += 1; });
  return (2 * common) / (leftFragments.size + rightFragments.size);
}

function appendAlignedInterval(before: LightweightBlock[], after: LightweightBlock[], changes: LightweightChange[]) {
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    const previous = before[beforeIndex];
    const next = after[afterIndex];
    if (!previous && next) {
      changes.push({ id: `added-${changes.length}`, kind: "added", after: next });
      afterIndex += 1;
      continue;
    }
    if (previous && !next) {
      changes.push({ id: `removed-${changes.length}`, kind: "removed", before: previous });
      beforeIndex += 1;
      continue;
    }
    if (!previous || !next) continue;
    const compatible = previous.kind === next.kind && (previous.kind !== "paragraph" || textSimilarity(previous.similarityText, next.similarityText) >= .2);
    if (compatible) {
      changes.push({ id: `modified-${changes.length}`, kind: "modified", before: previous, after: next });
      beforeIndex += 1;
      afterIndex += 1;
    } else {
      changes.push({ id: `removed-${changes.length}`, kind: "removed", before: previous });
      beforeIndex += 1;
    }
  }
}

function anchor(item: LightweightBlock): RevisionBlockAnchor {
  return {
    blockKind: item.kind,
    text: item.text,
    ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
    blockIndex: item.index,
  };
}

function samePaths(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftPaths = [...left].sort();
  const rightPaths = [...right].sort();
  return leftPaths.every((path, index) => path === rightPaths[index]);
}

export function computeLightweightRevisionLocations(input: LightweightRevisionDiffInput): RevisionLocation[] {
  const before = parseBlocks(input.beforeMarkdown);
  const after = parseBlocks(input.afterMarkdown);
  const pairs = pairExactSignatures(before, after);
  const changes: LightweightChange[] = [];
  let beforeCursor = 0;
  let afterCursor = 0;
  pairs.forEach(([beforeIndex, afterIndex]) => {
    appendAlignedInterval(before.slice(beforeCursor, beforeIndex), after.slice(afterCursor, afterIndex), changes);
    changes.push({ id: `same-${changes.length}`, kind: "unchanged", before: before[beforeIndex], after: after[afterIndex] });
    beforeCursor = beforeIndex + 1;
    afterCursor = afterIndex + 1;
  });
  appendAlignedInterval(before.slice(beforeCursor), after.slice(afterCursor), changes);

  const nextAfter: Array<LightweightBlock | undefined> = new Array(changes.length);
  const previousAfter: Array<LightweightBlock | undefined> = new Array(changes.length);
  let next: LightweightBlock | undefined;
  for (let index = changes.length - 1; index >= 0; index -= 1) {
    nextAfter[index] = next;
    if (changes[index]?.after) next = changes[index].after;
  }
  let previous: LightweightBlock | undefined;
  changes.forEach((change, index) => {
    previousAfter[index] = previous;
    if (change.after) previous = change.after;
  });

  const targetBlockCount = Math.max(1, after.length);
  const locations = changes.flatMap((change, index) => {
    if (change.kind === "unchanged") return [];
    const afterAnchor = change.after ? anchor(change.after) : undefined;
    const editorTarget = change.after ?? nextAfter[index] ?? previousAfter[index];
    const relativeBlock = change.after ?? nextAfter[index] ?? previousAfter[index] ?? change.before;
    if (!relativeBlock) return [];
    return [{
      id: `revision-location-light-${change.id}`,
      targetId: `revision-block-light-${change.id}`,
      kind: change.kind,
      blockId: change.id,
      ...(change.before ? { anchorBefore: anchor(change.before) } : {}),
      ...(afterAnchor ? { anchorAfter: afterAnchor } : {}),
      ...(editorTarget ? { editorAnchor: anchor(editorTarget) } : {}),
      headingPath: relativeBlock.headingPath,
      relativePosition: targetBlockCount === 1 ? 0 : relativeBlock.index / (targetBlockCount - 1),
    } satisfies RevisionLocation];
  });

  const supplementalChanged = input.beforeMetadata !== input.afterMetadata || !samePaths(input.beforeAssetPaths, input.afterAssetPaths);
  const supplementalTarget = after[0] ?? before[0];
  if (!supplementalChanged || !supplementalTarget) return locations;
  return [{
    id: "revision-location-light-settings",
    targetId: "revision-block-light-settings",
    kind: "modified",
    blockId: "settings",
    ...(after[0] ? { anchorAfter: anchor(after[0]) } : {}),
    editorAnchor: anchor(supplementalTarget),
    headingPath: supplementalTarget.headingPath,
    relativePosition: targetBlockCount === 1 ? 0 : supplementalTarget.index / (targetBlockCount - 1),
  }, ...locations];
}
