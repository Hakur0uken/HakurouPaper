import { useEffect, useMemo, useRef, useState, type CSSProperties, type JSX, type ReactNode } from "react";
import katex from "katex";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { parseDocumentSidecar } from "../../core/schema";
import { parseDocumentFormatSettings } from "../../formatTypes";
import { fontFamilyStack } from "../../appearanceSettings";
import type { UiText } from "../../i18n";
import { platform, type RevisionDescriptor, type RevisionDocumentSnapshot, type VersionComparison } from "../../platform";
import type { FeatureDocumentContext } from "../registry";
import { RevisionOverviewRuler } from "./RevisionOverviewRuler";
import type { RevisionBlockAnchor, RevisionLocation } from "./revisionTypes";

type MarkdownNode = {
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

type InlineDiffPart = { kind: "unchanged" | "added" | "removed"; value: string };
type IndexedMarkdownBlock = { node: MarkdownNode; index: number };
type ViewerState =
  | { kind: "loading" }
  | { kind: "ready"; comparison: VersionComparison; before: RevisionDocumentSnapshot; after: RevisionDocumentSnapshot }
  | { kind: "error"; message: string };
type ModelState = { kind: "idle" | "building" } | { kind: "ready"; model: RenderedRevisionModel } | { kind: "error"; message: string };

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

function stableHash(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

function imageUrlForBlock(node: MarkdownNode) {
  if (node.type === "image") return node.url;
  return markdownChildren(node).find((child) => child.type === "image")?.url;
}

function normalizedSignature(node: MarkdownNode, snapshot?: RevisionDocumentSnapshot) {
  const imageUrl = imageUrlForBlock(node);
  const image = imageUrl ? snapshot?.assets.find((asset) => asset.path === imageUrl) : undefined;
  const imageSignature = image ? `:${stableHash(image.dataBase64)}` : "";
  return `${blockKind(node)}:${markdownText(node).replace(/\s+/g, " ").trim().toLocaleLowerCase()}${imageSignature}`;
}

function pairByExactSignature(before: MarkdownNode[], after: MarkdownNode[], beforeSnapshot: RevisionDocumentSnapshot, afterSnapshot: RevisionDocumentSnapshot): Array<[number, number]> {
  if (before.length * after.length > 160_000) {
    const positions = new Map<string, number[]>();
    after.forEach((block, index) => {
      const signature = normalizedSignature(block, afterSnapshot);
      positions.set(signature, [...(positions.get(signature) ?? []), index]);
    });
    const pairs: Array<[number, number]> = [];
    let afterCursor = 0;
    before.forEach((block, beforeIndex) => {
      const candidates = positions.get(normalizedSignature(block, beforeSnapshot)) ?? [];
      const afterIndex = candidates.find((candidate) => candidate >= afterCursor);
      if (afterIndex !== undefined) {
        pairs.push([beforeIndex, afterIndex]);
        afterCursor = afterIndex + 1;
      }
    });
    return pairs;
  }

  const width = after.length + 1;
  const matrix = new Uint32Array((before.length + 1) * width);
  for (let beforeIndex = before.length - 1; beforeIndex >= 0; beforeIndex -= 1) {
    for (let afterIndex = after.length - 1; afterIndex >= 0; afterIndex -= 1) {
      const cell = beforeIndex * width + afterIndex;
      matrix[cell] = normalizedSignature(before[beforeIndex]!, beforeSnapshot) === normalizedSignature(after[afterIndex]!, afterSnapshot)
        ? matrix[(beforeIndex + 1) * width + afterIndex + 1]! + 1
        : Math.max(matrix[(beforeIndex + 1) * width + afterIndex]!, matrix[beforeIndex * width + afterIndex + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let beforeIndex = 0;
  let afterIndex = 0;
  while (beforeIndex < before.length && afterIndex < after.length) {
    if (normalizedSignature(before[beforeIndex]!, beforeSnapshot) === normalizedSignature(after[afterIndex]!, afterSnapshot)) {
      pairs.push([beforeIndex, afterIndex]);
      beforeIndex += 1;
      afterIndex += 1;
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
    const sameKind = blockKind(previous.node) === blockKind(next.node);
    const compatible = sameKind && (textSimilarity(markdownText(previous.node), markdownText(next.node)) >= 0.2 || blockKind(previous.node) !== "paragraph");
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
      blocks.push({ id: `removed-${blocks.length}`, blockKind: blockKind(previous.node), changeKind: "removed", before: previous.node, beforeBlockIndex: previous.index });
      beforeIndex += 1;
    }
  }
}

export function buildRenderedRevisionModel(before: RevisionDocumentSnapshot, after: RevisionDocumentSnapshot): RenderedRevisionModel {
  const beforeBlocks = parseMarkdownBlocks(before.markdown);
  const afterBlocks = parseMarkdownBlocks(after.markdown);
  const indexedBefore = beforeBlocks.map((node, index) => ({ node, index }));
  const indexedAfter = afterBlocks.map((node, index) => ({ node, index }));
  const matches = pairByExactSignature(beforeBlocks, afterBlocks, before, after);
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
  return model.blocks.flatMap((block, displayIndex) => {
    if (block.changeKind === "unchanged") return [];
    const nextAfterBlock = model.blocks.slice(displayIndex + 1).find((candidate) => candidate.after);
    const previousAfterBlock = model.blocks.slice(0, displayIndex).reverse().find((candidate) => candidate.after);
    const afterAnchor = block.after ? revisionAnchor(block.after, block.afterBlockIndex) : undefined;
    const editorAnchor = afterAnchor
      ?? (nextAfterBlock?.after ? revisionAnchor(nextAfterBlock.after, nextAfterBlock.afterBlockIndex) : previousAfterBlock?.after ? revisionAnchor(previousAfterBlock.after, previousAfterBlock.afterBlockIndex) : undefined);
    const relativeIndex = block.afterBlockIndex ?? nextAfterBlock?.afterBlockIndex ?? previousAfterBlock?.afterBlockIndex ?? block.beforeBlockIndex ?? 0;
    const primaryLocation = {
      id: `revision-location-${block.id}`,
      targetId: `revision-block-${block.id}`,
      kind: block.changeKind,
      blockId: block.id,
      ...(block.before ? { anchorBefore: revisionAnchor(block.before, block.beforeBlockIndex) } : {}),
      ...(afterAnchor ? { anchorAfter: afterAnchor } : {}),
      ...(editorAnchor ? { editorAnchor } : {}),
      headingPath: paths.get(block.afterBlockIndex ?? -1) ?? paths.get(Math.min(targetBlockCount - 1, relativeIndex)) ?? [],
      relativePosition: targetBlockCount === 1 ? 0 : relativeIndex / (targetBlockCount - 1),
    } satisfies RevisionLocation;
    // An inline deletion inside a rewritten block remains a single "modified"
    // location. Red is reserved for blocks that no longer exist at all.
    return [primaryLocation];
  });
}

function normalizedAssetPath(path: string) {
  let normalized = path.replace(/\\/g, "/");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep malformed percent sequences literal; the exact path is still retained below.
  }
  const segments: string[] = [];
  normalized.split("/").forEach((segment) => {
    if (!segment || segment === ".") return;
    if (segment === "..") {
      segments.pop();
      return;
    }
    segments.push(segment);
  });
  return `./${segments.join("/")}`;
}

function setAssetUrl(urls: Map<string, string>, path: string, value: string) {
  urls.set(path, value);
  urls.set(normalizedAssetPath(path), value);
}

function resolveAssetUrl(urls: Map<string, string>, path: string | undefined) {
  return path ? urls.get(path) ?? urls.get(normalizedAssetPath(path)) : undefined;
}

function createAssetUrls(snapshot: RevisionDocumentSnapshot) {
  const direct = new Map<string, string>();
  snapshot.assets.forEach((asset) => setAssetUrl(direct, asset.path, `data:${asset.mimeType};base64,${asset.dataBase64}`));
  try {
    const sidecar = parseDocumentSidecar(snapshot.metadata).sidecar;
    sidecar.assets.forEach((asset) => {
      const preview = resolveAssetUrl(direct, asset.preview?.path);
      const source = resolveAssetUrl(direct, asset.source.path);
      if (preview) setAssetUrl(direct, asset.source.path, preview);
      if (source && asset.preview?.path) setAssetUrl(direct, asset.preview.path, source);
    });
  } catch {
    // A malformed historical sidecar must not prevent the Markdown body from rendering.
  }
  return direct;
}

function formulaPreviewValue(value: string) {
  return value
    .replace(/\\(?:notag|nonumber)\b/g, "")
    .replace(/\\tag\*?\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
    .trim();
}

function Formula({ value, display }: { value: string; display: boolean }) {
  try {
    const html = katex.renderToString(formulaPreviewValue(value) || "\\text{公式为空}", { displayMode: display, throwOnError: true, strict: "ignore" });
    return <span className={display ? "revision-katex is-display" : "revision-katex"} dangerouslySetInnerHTML={{ __html: html }} />;
  } catch {
    return <details className="revision-formula-error"><summary>公式预览失败</summary><code>{value}</code></details>;
  }
}

function workingAssetFallback(node: MarkdownNode, documentPath: string | null | undefined) {
  if (!documentPath || !node.url || !/^\.\/assets\//i.test(node.url)) return undefined;
  return platform.assets.displaySource(node.url, documentPath);
}

function Image({ node, assetUrls, workingDocumentPath }: { node: MarkdownNode; assetUrls: Map<string, string>; workingDocumentPath?: string | null }) {
  const snapshotSource = resolveAssetUrl(assetUrls, node.url);
  const fallbackSource = workingAssetFallback(node, workingDocumentPath);
  const [source, setSource] = useState(snapshotSource ?? fallbackSource);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setSource(snapshotSource ?? fallbackSource);
    setFailed(false);
  }, [fallbackSource, snapshotSource]);

  if (!source || failed) return <span className="revision-missing-image" title={node.url ?? undefined}>图片预览不可用{node.url && <code>{node.url}</code>}</span>;
  return <img
    className="revision-image"
    src={source}
    alt={node.alt ?? ""}
    title={node.title ?? node.alt ?? ""}
    onError={() => {
      if (source !== fallbackSource && fallbackSource) setSource(fallbackSource);
      else setFailed(true);
    }}
  />;
}

function InlineNodes({ nodes, assetUrls, workingDocumentPath }: { nodes: MarkdownNode[]; assetUrls: Map<string, string>; workingDocumentPath?: string | null }): ReactNode {
  return nodes.map((node, index) => {
    const key = `${node.type}-${index}`;
    const children = <InlineNodes nodes={markdownChildren(node)} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />;
    if (node.type === "text") return <span key={key}>{node.value}</span>;
    if (node.type === "emphasis") return <em key={key}>{children}</em>;
    if (node.type === "strong") return <strong key={key}>{children}</strong>;
    if (node.type === "delete") return <del key={key}>{children}</del>;
    if (node.type === "inlineCode") return <code key={key}>{node.value}</code>;
    if (node.type === "inlineMath") return <Formula key={key} value={node.value ?? ""} display={false} />;
    if (node.type === "link") return <a key={key} href={node.url} title={node.title ?? undefined} target="_blank" rel="noreferrer">{children}</a>;
    if (node.type === "image") return <Image key={key} node={node} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />;
    if (node.type === "break") return <br key={key} />;
    return <span key={key}>{node.value ?? children}</span>;
  });
}

function MarkdownBlock({ node, assetUrls, inlineParts, workingDocumentPath }: { node: MarkdownNode; assetUrls: Map<string, string>; inlineParts?: InlineDiffPart[]; workingDocumentPath?: string | null }): ReactNode {
  const children = markdownChildren(node);
  const renderedInline = inlineParts
    ? inlineParts.map((part, index) => part.kind === "added"
      ? <ins key={index}>{part.value}</ins>
      : part.kind === "removed"
        ? <del key={index}>{part.value}</del>
        : <span key={index}>{part.value}</span>)
    : <InlineNodes nodes={children} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />;
  if (node.type === "heading") {
    const Tag = (`h${Math.min(6, Math.max(1, node.depth ?? 1))}`) as keyof JSX.IntrinsicElements;
    return <Tag className="revision-heading">{renderedInline}</Tag>;
  }
  if (node.type === "paragraph") return <p className="revision-paragraph">{renderedInline}</p>;
  if (node.type === "blockquote") return <blockquote>{children.map((child, index) => <MarkdownBlock key={index} node={child} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />)}</blockquote>;
  if (node.type === "list") {
    const Tag = node.ordered ? "ol" : "ul";
    return <Tag start={node.ordered && node.start ? node.start : undefined}>{children.map((child, index) => <MarkdownBlock key={index} node={child} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />)}</Tag>;
  }
  if (node.type === "listItem") return <li>{children.map((child, index) => <MarkdownBlock key={index} node={child} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />)}</li>;
  if (node.type === "code") return <pre><code className={node.lang ? `language-${node.lang}` : undefined}>{node.value}</code></pre>;
  if (node.type === "math") return <Formula value={node.value ?? ""} display />;
  if (node.type === "thematicBreak") return <hr />;
  if (node.type === "table") {
    const [header, ...body] = children;
    return <table><thead>{header && <MarkdownBlock node={{ ...header, header: true, align: node.align }} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />}</thead><tbody>{body.map((row, index) => <MarkdownBlock key={index} node={{ ...row, align: node.align }} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />)}</tbody></table>;
  }
  if (node.type === "tableRow") return <tr>{children.map((cell, index) => <MarkdownBlock key={index} node={{ ...cell, type: node.header ? "tableHeader" : "tableCell", alignValue: node.align?.[index] }} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />)}</tr>;
  if (node.type === "tableCell" || node.type === "tableHeader") {
    const Tag = node.type === "tableHeader" ? "th" : "td";
    return <Tag style={node.alignValue ? { textAlign: node.alignValue as CSSProperties["textAlign"] } : undefined}>{renderedInline}</Tag>;
  }
  if (node.type === "html") return <p className="revision-unsupported-block">{node.value}</p>;
  return <div className="revision-unsupported-block">{node.value ?? children.map((child, index) => <MarkdownBlock key={index} node={child} assetUrls={assetUrls} workingDocumentPath={workingDocumentPath} />)}</div>;
}

function revisionTitle(revision: RevisionDescriptor, text: UiText, side: "left" | "right") {
  if (revision.kind === "currentDocument") return text.versionCurrentDocument;
  if (revision.kind === "empty") return text.versionNoSavedRevision;
  return revision.title ?? revision.shortId ?? (side === "left" ? text.versionPreviousVersion : text.versionThisVersion);
}

function CompactRevisionMeta({ revision, side, text }: { revision: RevisionDescriptor; side: "left" | "right"; text: UiText }) {
  const role = revision.kind === "currentDocument"
    ? text.versionCurrentDocument
    : revision.kind === "empty"
      ? text.versionNoSavedRevision
      : side === "left" ? text.versionPreviousVersion : text.versionThisVersion;
  const details = revision.kind === "version"
    ? [revision.title ?? revision.shortId, revision.timestamp && new Date(revision.timestamp).toLocaleString()].filter(Boolean)
    : [];
  return <span className="rendered-revision-meta"><strong>{role}</strong>{details.map((detail, index) => <span key={index}>· {detail}</span>)}</span>;
}

function RevisionBlockView({ block, beforeAssets, afterAssets, afterWorkingDocumentPath, location, isNavigationTarget, text }: { block: RevisionBlock; beforeAssets: Map<string, string>; afterAssets: Map<string, string>; afterWorkingDocumentPath?: string | null; location?: RevisionLocation; isNavigationTarget?: boolean; text: UiText }) {
  const locationProps = location ? { id: location.targetId, "data-revision-location": location.id } : {};
  const targetClass = isNavigationTarget ? " is-navigation-target" : "";
  if (block.changeKind === "unchanged" && block.after) return <div className="rendered-revision-block"><MarkdownBlock node={block.after} assetUrls={afterAssets} workingDocumentPath={afterWorkingDocumentPath} /></div>;
  if (block.changeKind === "added" && block.after) return <div {...locationProps} className={`rendered-revision-block is-added${targetClass}`}><span className="revision-change-label">{text.versionChangeAdded}</span><MarkdownBlock node={block.after} assetUrls={afterAssets} workingDocumentPath={afterWorkingDocumentPath} /></div>;
  if (block.changeKind === "removed" && block.before) return <div {...locationProps} className={`rendered-revision-block is-removed${targetClass}`}><span className="revision-change-label">{text.versionChangeDeleted}</span><MarkdownBlock node={block.before} assetUrls={beforeAssets} /></div>;
  if (!block.before || !block.after) return null;
  if (block.inlineDiff) return <div {...locationProps} className={`rendered-revision-block is-modified${targetClass}`}><MarkdownBlock node={block.after} assetUrls={afterAssets} inlineParts={block.inlineDiff} workingDocumentPath={afterWorkingDocumentPath} /></div>;
  return <div {...locationProps} className={`rendered-revision-block is-modified revision-block-replacement${targetClass}`}>
    <span className="revision-change-label">{text.versionBefore}</span>
    <div className="revision-block-before"><MarkdownBlock node={block.before} assetUrls={beforeAssets} /></div>
    <span className="revision-change-label">{text.versionAfter}</span>
    <div className="revision-block-after"><MarkdownBlock node={block.after} assetUrls={afterAssets} workingDocumentPath={afterWorkingDocumentPath} /></div>
  </div>;
}

export function RenderedRevisionViewer({ document, versionId, initialLocationId, text, onClose, onOpenAdvanced, onRestoreVersion }: { document: FeatureDocumentContext; versionId: string | null; initialLocationId?: string | null; text: UiText; onClose: () => void; onOpenAdvanced: () => void; onRestoreVersion: (targetCommitId: string, targetTitle: string) => void }) {
  const [viewerState, setViewerState] = useState<ViewerState>({ kind: "loading" });
  const [modelState, setModelState] = useState<ModelState>({ kind: "idle" });
  const [activeLocationId, setActiveLocationId] = useState<string | null>(initialLocationId ?? null);
  const viewerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!document.path) return;
    let disposed = false;
    setViewerState({ kind: "loading" });
    void (async () => {
      try {
        const comparison = await platform.versionControl.getComparison({ documentPath: document.path!, assetFolder: document.assetFolder, versionId });
        const [before, after] = await Promise.all([
          platform.versionControl.getRevisionDocumentSnapshot({ documentPath: document.path!, assetFolder: document.assetFolder, revisionId: comparison.baseRevision.id ?? null }),
          platform.versionControl.getRevisionDocumentSnapshot({
            documentPath: document.path!,
            assetFolder: document.assetFolder,
            revisionId: comparison.targetRevision.kind === "version" ? comparison.targetRevision.id ?? null : null,
            useWorkingCopy: comparison.targetRevision.kind === "currentDocument",
            workingContent: comparison.targetRevision.kind === "currentDocument" ? document.content : null,
          }),
        ]);
        if (!disposed) setViewerState({
          kind: "ready",
          comparison,
          before,
          after: comparison.targetRevision.kind === "currentDocument" ? { ...after, metadata: document.sidecarContent } : after,
        });
      } catch (error) {
        if (!disposed) setViewerState({ kind: "error", message: String(error) });
      }
    })();
    return () => { disposed = true; };
  }, [document.assetFolder, document.content, document.path, document.sidecarContent, versionId]);

  useEffect(() => {
    if (viewerState.kind !== "ready") return;
    let disposed = false;
    setModelState({ kind: "building" });
    const timer = window.setTimeout(() => {
      try {
        if (!disposed) setModelState({ kind: "ready", model: buildRenderedRevisionModel(viewerState.before, viewerState.after) });
      } catch (error) {
        if (!disposed) setModelState({ kind: "error", message: String(error) });
      }
    }, 0);
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [viewerState]);

  const assetUrls = useMemo(() => viewerState.kind === "ready"
    ? { before: createAssetUrls(viewerState.before), after: createAssetUrls(viewerState.after) }
    : null, [viewerState]);
  const revisionFormatDefaults = useMemo(() => {
    if (viewerState.kind !== "ready") return undefined;
    const parsed = parseDocumentSidecar(viewerState.after.metadata).sidecar;
    return parseDocumentFormatSettings(parsed.format).defaults;
  }, [viewerState]);
  const formatStyle = useMemo<CSSProperties | undefined>(() => {
    const defaults = revisionFormatDefaults;
    return defaults?.font ? {
      "--hakurou-document-font-family": fontFamilyStack(defaults.font),
      "--hakurou-document-font-weight": String(defaults.font.weight),
    } as CSSProperties : undefined;
  }, [revisionFormatDefaults]);
  const targetVersion = viewerState.kind === "ready" ? viewerState.comparison.targetRevision : null;
  const settingsChanged = viewerState.kind === "ready" && viewerState.before.metadata !== viewerState.after.metadata;
  const afterWorkingDocumentPath = viewerState.kind === "ready" && viewerState.after.revision.kind === "currentDocument"
    ? document.path
    : null;
  const locations = useMemo(() => modelState.kind === "ready" ? buildRevisionLocations(modelState.model) : [], [modelState]);
  const locationsByBlock = useMemo(() => new Map(locations.map((location) => [location.blockId, location])), [locations]);
  const activeLocationIndex = locations.findIndex((location) => location.id === activeLocationId);
  const activeLocation = locations.find((location) => location.id === activeLocationId);
  const navigateToLocation = (location: RevisionLocation) => {
    setActiveLocationId(location.id);
    window.requestAnimationFrame(() => window.document.getElementById(location.targetId)?.scrollIntoView({ block: "center", behavior: "auto" }));
  };
  const navigateByOffset = (offset: number) => {
    if (locations.length === 0) return;
    const nextIndex = activeLocationIndex < 0
      ? (offset > 0 ? 0 : locations.length - 1)
      : (activeLocationIndex + offset + locations.length) % locations.length;
    navigateToLocation(locations[nextIndex]!);
  };

  useEffect(() => {
    if (!initialLocationId || !locations.some((location) => location.id === initialLocationId)) return;
    navigateToLocation(locations.find((location) => location.id === initialLocationId)!);
  // The initial target should be consumed only after the asynchronous model becomes available.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocationId, locations]);

  return <section ref={viewerRef} className="rendered-revision-viewer" aria-label={text.versionRenderedPreview}>
    <header className="rendered-revision-toolbar">
      <div className="rendered-revision-toolbar-main">
        <div className="rendered-revision-title-line">
          <h1>{text.versionRenderedPreview}</h1>
          {modelState.kind === "ready" && <span>{text.versionRenderedChangeCount(modelState.model.summary.changeGroups)}</span>}
          {locations.length > 0 && <span>{`${Math.max(1, activeLocationIndex + 1)} / ${locations.length}`}</span>}
          {settingsChanged && <span>{text.versionSettingsChanged}</span>}
          {document.isDirty && <span>{text.versionPreviewUnsavedContent}</span>}
        </div>
        <div className="rendered-revision-actions">
          {locations.length > 0 && <><button type="button" onClick={() => navigateByOffset(-1)}>{text.versionPreviousChange}</button><button type="button" onClick={() => navigateByOffset(1)}>{text.versionNextChange}</button></>}
          <button type="button" onClick={onOpenAdvanced}>{text.versionAdvancedCompare}</button>
          {targetVersion?.kind === "version" && targetVersion.id && <button type="button" className="is-primary" onClick={() => onRestoreVersion(targetVersion.id!, revisionTitle(targetVersion, text, "right"))}>{text.versionRestoreThis}</button>}
          <button type="button" onClick={onClose}>{text.versionDiffClose}</button>
        </div>
      </div>
      {viewerState.kind === "ready" && <div className="rendered-revision-pair"><CompactRevisionMeta revision={viewerState.comparison.baseRevision} side="left" text={text} /><span className="rendered-revision-arrow" aria-hidden="true">→</span><CompactRevisionMeta revision={viewerState.comparison.targetRevision} side="right" text={text} /></div>}
    </header>
    {(viewerState.kind === "loading" || modelState.kind === "building") && <p className="rendered-revision-message">{text.versionRenderedLoading}</p>}
    {viewerState.kind === "error" && <p className="rendered-revision-message is-error">{viewerState.message}</p>}
    {modelState.kind === "error" && <div className="rendered-revision-message is-error"><p>{text.versionRenderedFailed}</p><p>{modelState.message}</p><button type="button" onClick={onOpenAdvanced}>{text.versionAdvancedCompare}</button></div>}
    {modelState.kind === "ready" && assetUrls && <div className="rendered-revision-content">
      <article className={`rendered-revision-document ${revisionFormatDefaults?.tableStyle === "three-line" ? "is-three-line" : ""} ${revisionFormatDefaults?.firstLineIndent ? "is-first-line-indented" : ""}`} style={formatStyle}>
        {modelState.model.blocks.map((block) => {
          const location = locationsByBlock.get(block.id);
          return <RevisionBlockView key={block.id} block={block} beforeAssets={assetUrls.before} afterAssets={assetUrls.after} afterWorkingDocumentPath={afterWorkingDocumentPath} location={location} isNavigationTarget={location?.targetId === activeLocation?.targetId} text={text} />;
        })}
      </article>
      <RevisionOverviewRuler locations={locations} activeLocationId={activeLocationId} onNavigate={navigateToLocation} scrollContainer={viewerRef.current} />
    </div>}
  </section>;
}
