import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { RevisionDescriptor, RevisionTextSnapshot } from "../../platform";
import type { RevisionBlockAnchor, RevisionLocation } from "./revisionTypes";

export type MarkdownNode = {
  type: string;
  value?: string;
  children?: MarkdownNode[];
  depth?: number;
  url?: string;
  title?: string | null;
  alt?: string;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  lang?: string | null;
  align?: Array<string | null>;
  alignValue?: string | null;
  header?: boolean;
};

export type RevisionBlockKind = "heading" | "paragraph" | "list" | "blockquote" | "math" | "image" | "table" | "code" | "horizontalRule" | "other";
export type RevisionChangeKind = "unchanged" | "added" | "removed" | "modified";
export type InlineDiffPart = { kind: "unchanged" | "added" | "removed"; value: string };

export type RevisionBlock = {
  id: string;
  blockKind: RevisionBlockKind;
  changeKind: RevisionChangeKind;
  before?: MarkdownNode;
  after?: MarkdownNode;
  beforeBlockIndex?: number;
  afterBlockIndex?: number;
  inlineDiff?: InlineDiffPart[];
};

export type RenderedRevisionModel = {
  leftRevision: RevisionDescriptor;
  rightRevision: RevisionDescriptor;
  blocks: RevisionBlock[];
  summary: { changeGroups: number };
};

type IndexedMarkdownBlock = { node: MarkdownNode; index: number };

const markdownProcessor = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

function markdownChildren(node: MarkdownNode | undefined) {
  return node?.children ?? [];
}

function parseMarkdownBlocks(markdown: string): MarkdownNode[] {
  try {
    const root = markdownProcessor.parse(markdown) as unknown as MarkdownNode;
    return markdownChildren(root);
  } catch {
    return [{ type: "paragraph", children: [{ type: "text", value: markdown }] }];
  }
}

function blockKind(node: MarkdownNode): RevisionBlockKind {
  if (node.type === "heading") return "heading";
  if (node.type === "paragraph") return markdownChildren(node).length === 1 && markdownChildren(node)[0]?.type === "image" ? "image" : "paragraph";
  if (node.type === "list") return "list";
  if (node.type === "blockquote") return "blockquote";
  if (node.type === "math") return "math";
  if (node.type === "table") return "table";
  if (node.type === "code") return "code";
  if (node.type === "thematicBreak") return "horizontalRule";
  return "other";
}

function markdownText(node: MarkdownNode): string {
  if (typeof node.value === "string") return node.value;
  if (node.type === "image") return `${node.alt ?? ""} ${node.url ?? ""}`;
  return markdownChildren(node).map(markdownText).join("");
}

function imageUrlForBlock(node: MarkdownNode) {
  if (node.type === "image") return node.url;
  return markdownChildren(node).find((child) => child.type === "image")?.url;
}

function snapshotAssetSignatures(snapshot: RevisionTextSnapshot) {
  return new Map(snapshot.assets.map((asset) => [asset.path, asset.contentHash ?? `${asset.mimeType}:${asset.path}`]));
}

function normalizedSignature(node: MarkdownNode, assetSignatures: ReadonlyMap<string, string>) {
  const imageUrl = imageUrlForBlock(node);
  const imageSignature = imageUrl ? assetSignatures.get(imageUrl) : undefined;
  return `${blockKind(node)}:${markdownText(node).replace(/\s+/g, " ").trim().toLocaleLowerCase()}${imageSignature ? `:${imageSignature}` : ""}`;
}

function pairByExactSignature(beforeSignatures: string[], afterSignatures: string[]): Array<[number, number]> {
  const beforeLength = beforeSignatures.length;
  const afterLength = afterSignatures.length;
  if (beforeLength * afterLength > 160_000) {
    const positions = new Map<string, number[]>();
    afterSignatures.forEach((signature, index) => {
      const candidates = positions.get(signature);
      if (candidates) candidates.push(index);
      else positions.set(signature, [index]);
    });
    const cursors = new Map<string, number>();
    const pairs: Array<[number, number]> = [];
    let afterCursor = 0;
    beforeSignatures.forEach((signature, beforeIndex) => {
      const candidates = positions.get(signature) ?? [];
      let cursor = cursors.get(signature) ?? 0;
      while (cursor < candidates.length && candidates[cursor]! < afterCursor) cursor += 1;
      cursors.set(signature, cursor);
      const afterIndex = candidates[cursor];
      if (afterIndex === undefined) return;
      pairs.push([beforeIndex, afterIndex]);
      afterCursor = afterIndex + 1;
      cursors.set(signature, cursor + 1);
    });
    return pairs;
  }

  const width = afterLength + 1;
  const matrix = new Uint32Array((beforeLength + 1) * width);
  for (let beforeIndex = beforeLength - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = afterLength - 1; afterIndex >= 0; afterIndex -= 1) {
      const cell = beforeIndex * width + afterIndex;
      matrix[cell] = beforeSignatures[beforeIndex] === afterSignatures[afterIndex]
        ? matrix[(beforeIndex + 1) * width + afterIndex + 1]! + 1
        : Math.max(matrix[(beforeIndex + 1) * width + afterIndex]!, matrix[beforeIndex * width + afterIndex + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < beforeLength && afterIndex < afterLength) {
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
  const normalize = (value: string) => value.replace(/\s+/g, "").toLocaleLowerCase();
  const leftValue = normalize(left);
  const rightValue = normalize(right);
  if (!leftValue || !rightValue) return 0;
  if (leftValue === rightValue) return 1;
  const fragments = (value: string) => Array.from(value.length < 3 ? value : value.match(/.{1,2}/g) ?? []);
  const leftFragments = new Set(fragments(leftValue));
  const rightFragments = new Set(fragments(rightValue));
  let common = 0;
  leftFragments.forEach((fragment) => { if (rightFragments.has(fragment)) common += 1; });
  return (2 * common) / (leftFragments.size + rightFragments.size);
}

function textOnly(node: MarkdownNode) {
  return markdownChildren(node).length > 0 && markdownChildren(node).every((child) => child.type === "text");
}

function splitInlineTokens(value: string) {
  return value.match(/[\u3400-\u9fff]|[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*|\s+|[^\s]/g) ?? [];
}

function inlineDiff(before: MarkdownNode, after: MarkdownNode): InlineDiffPart[] | null {
  if (!textOnly(before) || !textOnly(after)) return null;
  const left = splitInlineTokens(markdownText(before));
  const right = splitInlineTokens(markdownText(after));
  if (left.length * right.length > 14_000) return null;
  const width = right.length + 1;
  const matrix = new Uint16Array((left.length + 1) * width);
  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      const index = leftIndex * width + rightIndex;
      matrix[index] = left[leftIndex] === right[rightIndex]
        ? matrix[(leftIndex + 1) * width + rightIndex + 1]! + 1
        : Math.max(matrix[(leftIndex + 1) * width + rightIndex]!, matrix[leftIndex * width + rightIndex + 1]!);
    }
  }
  const parts: InlineDiffPart[] = [];
  const append = (kind: InlineDiffPart["kind"], value: string) => {
    const previous = parts[parts.length - 1];
    if (previous?.kind === kind) previous.value += value;
    else parts.push({ kind, value });
  };
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex < left.length && rightIndex < right.length && left[leftIndex] === right[rightIndex]) {
      append("unchanged", left[leftIndex]!);
      leftIndex += 1;
      rightIndex += 1;
    } else if (rightIndex < right.length && (leftIndex === left.length || matrix[(leftIndex + 1) * width + rightIndex]! < matrix[leftIndex * width + rightIndex + 1]!)) {
      append("added", right[rightIndex]!);
      rightIndex += 1;
    } else if (leftIndex < left.length) {
      append("removed", left[leftIndex]!);
      leftIndex += 1;
    }
  }
  return parts.some((part) => part.kind !== "unchanged") ? parts : null;
}

function alignInterval(before: IndexedMarkdownBlock[], after: IndexedMarkdownBlock[], blocks: RevisionBlock[]) {
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length || afterIndex < after.length) {
    const previous = before[beforeIndex];
    const next = after[afterIndex];
    if (!previous && next) {
      blocks.push({ id: `added-${blocks.length}`, blockKind: blockKind(next.node), changeKind: "added", after: next.node, afterBlockIndex: next.index });
      afterIndex += 1;
      continue;
    }
    if (previous && !next) {
      blocks.push({ id: `removed-${blocks.length}`, blockKind: blockKind(previous.node), changeKind: "removed", before: previous.node, beforeBlockIndex: previous.index });
      beforeIndex += 1;
      continue;
    }
    if (!previous || !next) continue;
    const previousKind = blockKind(previous.node);
    const compatible = previousKind === blockKind(next.node)
      && (previousKind !== "paragraph" || textSimilarity(markdownText(previous.node), markdownText(next.node)) >= .2);
    if (compatible) {
      blocks.push({
        id: `modified-${blocks.length}`,
        blockKind: blockKind(next.node),
        changeKind: "modified",
        before: previous.node,
        after: next.node,
        beforeBlockIndex: previous.index,
        afterBlockIndex: next.index,
        inlineDiff: inlineDiff(previous.node, next.node) ?? undefined,
      });
      beforeIndex += 1;
      afterIndex += 1;
    } else {
      blocks.push({ id: `removed-${blocks.length}`, blockKind: previousKind, changeKind: "removed", before: previous.node, beforeBlockIndex: previous.index });
      beforeIndex += 1;
    }
  }
}

export function buildRenderedRevisionModel(before: RevisionTextSnapshot, after: RevisionTextSnapshot): RenderedRevisionModel {
  const beforeBlocks = parseMarkdownBlocks(before.markdown);
  const afterBlocks = parseMarkdownBlocks(after.markdown);
  const beforeAssetSignatures = snapshotAssetSignatures(before);
  const afterAssetSignatures = snapshotAssetSignatures(after);
  // Signatures and image object ids are prepared once before LCS enters its matrix loop.
  const beforeSignatures = beforeBlocks.map((block) => normalizedSignature(block, beforeAssetSignatures));
  const afterSignatures = afterBlocks.map((block) => normalizedSignature(block, afterAssetSignatures));
  const indexedBefore = beforeBlocks.map((node, index) => ({ node, index }));
  const indexedAfter = afterBlocks.map((node, index) => ({ node, index }));
  const matches = pairByExactSignature(beforeSignatures, afterSignatures);
  const blocks: RevisionBlock[] = [];
  let beforeCursor = 0;
  let afterCursor = 0;
  for (const [beforeIndex, afterIndex] of matches) {
    alignInterval(indexedBefore.slice(beforeCursor, beforeIndex), indexedAfter.slice(afterCursor, afterIndex), blocks);
    blocks.push({
      id: `same-${blocks.length}`,
      blockKind: blockKind(afterBlocks[afterIndex]!),
      changeKind: "unchanged",
      before: beforeBlocks[beforeIndex],
      after: afterBlocks[afterIndex],
      beforeBlockIndex: beforeIndex,
      afterBlockIndex: afterIndex,
    });
    beforeCursor = beforeIndex + 1;
    afterCursor = afterIndex + 1;
  }
  alignInterval(indexedBefore.slice(beforeCursor), indexedAfter.slice(afterCursor), blocks);
  let changeGroups = 0;
  let previousWasChanged = false;
  blocks.forEach((block) => {
    const changed = block.changeKind !== "unchanged";
    if (changed && !previousWasChanged) changeGroups += 1;
    previousWasChanged = changed;
  });
  return { leftRevision: before.revision, rightRevision: after.revision, blocks, summary: { changeGroups } };
}

function revisionAnchor(node: MarkdownNode, blockIndex?: number): RevisionBlockAnchor {
  const imageUrl = imageUrlForBlock(node);
  return {
    blockKind: blockKind(node),
    text: markdownText(node).replace(/\s+/g, " ").trim(),
    ...(imageUrl ? { imageUrl } : {}),
    ...(blockIndex === undefined ? {} : { blockIndex }),
  };
}

function headingPaths(blocks: RevisionBlock[]) {
  const paths = new Map<number, string[]>();
  const headings: string[] = [];
  blocks
    .filter((block) => block.after && block.afterBlockIndex !== undefined)
    .sort((left, right) => left.afterBlockIndex! - right.afterBlockIndex!)
    .forEach((block) => {
      const node = block.after!;
      if (node.type === "heading") {
        const depth = Math.max(1, node.depth ?? 1);
        headings.length = depth - 1;
        headings[depth - 1] = markdownText(node).replace(/\s+/g, " ").trim() || "章节";
      }
      paths.set(block.afterBlockIndex!, headings.filter(Boolean));
    });
  return paths;
}

export function buildRevisionLocations(model: RenderedRevisionModel): RevisionLocation[] {
  const paths = headingPaths(model.blocks);
  const targetBlockCount = Math.max(1, model.blocks.reduce((maximum, block) => Math.max(maximum, block.afterBlockIndex ?? -1), -1) + 1);
  const nextAfter: Array<RevisionBlock | undefined> = new Array(model.blocks.length);
  const previousAfter: Array<RevisionBlock | undefined> = new Array(model.blocks.length);
  let next: RevisionBlock | undefined;
  for (let index = model.blocks.length - 1; index >= 0; index -= 1) {
    nextAfter[index] = next;
    if (model.blocks[index]?.after) next = model.blocks[index];
  }
  let previous: RevisionBlock | undefined;
  model.blocks.forEach((block, index) => {
    previousAfter[index] = previous;
    if (block.after) previous = block;
  });
  return model.blocks.flatMap((block, displayIndex) => {
    if (block.changeKind === "unchanged") return [];
    const nextBlock = nextAfter[displayIndex];
    const previousBlock = previousAfter[displayIndex];
    const afterAnchor = block.after ? revisionAnchor(block.after, block.afterBlockIndex) : undefined;
    const editorAnchor = afterAnchor
      ?? (nextBlock?.after ? revisionAnchor(nextBlock.after, nextBlock.afterBlockIndex) : previousBlock?.after ? revisionAnchor(previousBlock.after, previousBlock.afterBlockIndex) : undefined);
    const relativeIndex = block.afterBlockIndex ?? nextBlock?.afterBlockIndex ?? previousBlock?.afterBlockIndex ?? block.beforeBlockIndex ?? 0;
    return [{
      id: `revision-location-${block.id}`,
      targetId: `revision-block-${block.id}`,
      kind: block.changeKind,
      blockId: block.id,
      ...(block.before ? { anchorBefore: revisionAnchor(block.before, block.beforeBlockIndex) } : {}),
      ...(afterAnchor ? { anchorAfter: afterAnchor } : {}),
      ...(editorAnchor ? { editorAnchor } : {}),
      headingPath: paths.get(block.afterBlockIndex ?? -1) ?? paths.get(Math.min(targetBlockCount - 1, relativeIndex)) ?? [],
      relativePosition: targetBlockCount === 1 ? 0 : relativeIndex / (targetBlockCount - 1),
    } satisfies RevisionLocation];
  });
}
