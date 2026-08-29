import { $prose } from "@milkdown/utils";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Plugin, PluginKey, type Transaction } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import type { RevisionBlockAnchor, RevisionLocation } from "./features/version-control/revisionTypes";

type RevisionDecorationConfig = { enabled: boolean; locations: RevisionLocation[]; baselineKey: string };
type MarkerAnchor = {
  id: string;
  kind: Exclude<RevisionLocation["kind"], "removed">;
  from: number;
  to: number;
  /** A transaction-only marker for a newly created empty paragraph. */
  pending?: boolean;
};
type DecorationBuild = { decorations: DecorationSet; markerAnchors: MarkerAnchor[] };
type RevisionDecorationState = RevisionDecorationConfig & DecorationBuild;
type Candidate = { position: number; index: number; node: ProseNode; kind: string; text: string; image?: string };
type CandidateIndex = { candidates: Candidate[]; byText: Map<string, Candidate>; byImage: Map<string, Candidate> };

export const revisionDecorationPluginKey = new PluginKey<RevisionDecorationState>("hakurou-revision-decoration");

function normalized(value: string) {
  return value.replace(/\\/g, "/").replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function imageSource(node: ProseNode): string | undefined {
  let source: string | undefined;
  node.descendants((child) => {
    if (child.type.name === "image") source = String(child.attrs.src ?? "");
  });
  return source;
}

function proseBlockKind(node: ProseNode) {
  if (node.type.name === "heading") return "heading";
  if (node.type.name === "bullet_list" || node.type.name === "ordered_list") return "list";
  if (node.type.name === "blockquote") return "blockquote";
  if (node.type.name === "table") return "table";
  if (node.type.name === "code_block" || node.type.name === "fence") return "code";
  if (node.type.name.includes("math")) return "math";
  if (imageSource(node)) return "image";
  return "paragraph";
}

function candidateKey(kind: string, value: string) {
  return `${kind}\u0000${value}`;
}

function topLevelCandidates(doc: ProseNode): CandidateIndex {
  const candidates: Candidate[] = [];
  const byText = new Map<string, Candidate>();
  const byImage = new Map<string, Candidate>();
  doc.forEach((node, position, index) => {
    const kind = proseBlockKind(node);
    const text = normalized(node.textContent);
    const image = imageSource(node);
    const candidate = { node, position, index, kind, text, ...(image ? { image: normalized(image) } : {}) };
    candidates.push(candidate);
    if (text) byText.set(candidateKey(kind, text), candidate);
    if (candidate.image) byImage.set(candidateKey(kind, candidate.image), candidate);
  });
  return { candidates, byText, byImage };
}

function candidateForAnchor(index: CandidateIndex, anchor: RevisionBlockAnchor | undefined) {
  if (!anchor) return undefined;
  const anchorText = normalized(anchor.text);
  const anchorImage = anchor.imageUrl ? normalized(anchor.imageUrl) : undefined;
  const indexed = anchor.blockIndex === undefined ? undefined : index.candidates[anchor.blockIndex];
  if (indexed?.kind === anchor.blockKind && (!anchorImage || indexed.image === anchorImage) && (!anchorText || indexed.text === anchorText)) return indexed;
  if (anchorImage) {
    const imageCandidate = index.byImage.get(candidateKey(anchor.blockKind, anchorImage));
    if (imageCandidate) return imageCandidate;
  }
  if (anchorText) {
    const textCandidate = index.byText.get(candidateKey(anchor.blockKind, anchorText));
    if (textCandidate) return textCandidate;
  }
  return indexed;
}

function markerElement(location: RevisionLocation, onDeletedLocationClick: (locationId: string) => void) {
  const marker = window.document.createElement("button");
  marker.type = "button";
  marker.className = "hakurou-revision-deleted-marker";
  marker.dataset.revisionLocation = location.id;
  marker.title = "查看已删除内容";
  marker.setAttribute("aria-label", "查看已删除内容");
  marker.addEventListener("mousedown", (event) => event.preventDefault());
  marker.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onDeletedLocationClick(location.id);
  });
  return marker;
}

function gutterDecoration(position: number, node: ProseNode, id: string, kind: MarkerAnchor["kind"]) {
  return Decoration.node(position, position + node.nodeSize, {
    class: `hakurou-revision-gutter is-${kind}`,
    "data-revision-location": id,
  }, { key: `${id}:${position}`, revisionLocationId: id });
}

function createRevisionDecorations(doc: ProseNode, enabled: boolean, locations: RevisionLocation[], onDeletedLocationClick: (locationId: string) => void): DecorationBuild {
  if (!enabled || locations.length === 0) return { decorations: DecorationSet.empty, markerAnchors: [] };
  const candidates = topLevelCandidates(doc);
  const decorations: Decoration[] = [];
  const markerAnchors: MarkerAnchor[] = [];
  const occupiedPositions = new Set<number>();
  locations.forEach((location) => {
    const candidate = candidateForAnchor(candidates, location.kind === "removed" ? location.editorAnchor : location.anchorAfter);
    const position = candidate?.position ?? doc.content.size;
    if (location.kind === "removed") {
      decorations.push(Decoration.widget(position, () => markerElement(location, onDeletedLocationClick), { key: location.id, side: -1, revisionLocationId: location.id }));
      return;
    }
    if (!candidate) return;
    if (occupiedPositions.has(position)) return;
    occupiedPositions.add(position);
    decorations.push(gutterDecoration(position, candidate.node, location.id, location.kind));
    markerAnchors.push({ id: location.id, kind: location.kind, from: position, to: position + candidate.node.nodeSize });
  });
  return { decorations: DecorationSet.create(doc, decorations), markerAnchors };
}

function candidatesOverlappingRange(doc: ProseNode, from: number, to: number) {
  const candidates: Array<{ position: number; node: ProseNode }> = [];
  doc.forEach((node, position) => {
    const end = position + node.nodeSize;
    // A split expands the mapped range across its new sibling. Strict overlap
    // deliberately excludes the next, unchanged block that starts at `to`.
    if (position < to && end > from) candidates.push({ position, node });
  });
  return candidates;
}

function preserveMappedMarkers(previous: RevisionDecorationState, transaction: Transaction) {
  const decorations = previous.decorations.map(transaction.mapping, transaction.doc);
  const coveredMarkerRanges = new Set(decorations.find().flatMap((decoration) => {
    const id = decoration.spec.revisionLocationId;
    return typeof id === "string" ? [`${decoration.from}:${decoration.to}`] : [];
  }));
  const markerAnchors = previous.markerAnchors.flatMap((anchor) => {
    const from = transaction.mapping.mapResult(anchor.from, -1);
    const to = transaction.mapping.mapResult(anchor.to, 1);
    // Backspace joining the provisional empty paragraph deletes its opening
    // boundary. Do not let that transient green marker migrate onto the
    // preceding paragraph.
    if (anchor.pending && (from.deleted || to.deleted)) return [];
    return [{ ...anchor, from: from.pos, to: to.pos }];
  });
  const restored: Decoration[] = [];
  markerAnchors.forEach((anchor) => {
    candidatesOverlappingRange(transaction.doc, anchor.from, anchor.to).forEach((candidate) => {
      const end = candidate.position + candidate.node.nodeSize;
      // Retain the old marker for every resulting sibling while the worker is
      // settling the new diff. A single surviving sibling must not make a
      // freshly split sibling lose its colour.
      if (coveredMarkerRanges.has(`${candidate.position}:${end}`)) return;
      restored.push(gutterDecoration(candidate.position, candidate.node, anchor.id, anchor.kind));
      coveredMarkerRanges.add(`${candidate.position}:${end}`);
    });
  });
  return {
    decorations: restored.length > 0 ? decorations.add(transaction.doc, restored) : decorations,
    markerAnchors,
  } satisfies DecorationBuild;
}

function newlyInsertedEmptyParagraphs(transaction: Transaction) {
  const inverseMapping = transaction.mapping.invert();
  return topLevelCandidates(transaction.doc).candidates.filter((candidate) => (
    candidate.kind === "paragraph"
    && candidate.node.content.size === 0
    // New empty paragraphs made by Enter have no corresponding old boundary.
    && inverseMapping.mapResult(candidate.position, -1).deleted
  ));
}

function addPendingEmptyMarkers(build: DecorationBuild, transaction: Transaction, nextId: () => string) {
  const pendingCandidates = newlyInsertedEmptyParagraphs(transaction);
  if (pendingCandidates.length === 0) return build;
  let decorations = build.decorations;
  const existingRanges = new Set(decorations.find().map((decoration) => `${decoration.from}:${decoration.to}`));
  const additions: Decoration[] = [];
  const markerAnchors = [...build.markerAnchors];
  pendingCandidates.forEach((candidate) => {
    const to = candidate.position + candidate.node.nodeSize;
    const range = `${candidate.position}:${to}`;
    // The old block's transitional colour may have been extended over this
    // fresh sibling. Enter still creates a new block, so promote that sibling
    // to a provisional green marker immediately.
    const replacements = decorations.find(candidate.position, to)
      .filter((decoration) => decoration.from === candidate.position && decoration.to === to);
    if (replacements.length > 0) decorations = decorations.remove(replacements);
    existingRanges.delete(range);
    const id = nextId();
    additions.push(gutterDecoration(candidate.position, candidate.node, id, "added"));
    existingRanges.add(range);
    markerAnchors.push({ id, kind: "added", from: candidate.position, to, pending: true });
  });
  return {
    decorations: additions.length > 0 ? decorations.add(transaction.doc, additions) : decorations,
    markerAnchors,
  } satisfies DecorationBuild;
}

function retainPendingEmptyMarkers(previous: RevisionDecorationState, transaction: Transaction, build: DecorationBuild) {
  const pendingAnchors = previous.markerAnchors
    .filter((anchor) => anchor.pending)
    .map((anchor) => ({
      ...anchor,
      from: transaction.mapping.map(anchor.from, -1),
      to: transaction.mapping.map(anchor.to, 1),
    }));
  if (pendingAnchors.length === 0) return build;
  const currentRanges = new Set(build.decorations.find().map((decoration) => `${decoration.from}:${decoration.to}`));
  const additions: Decoration[] = [];
  const retained: MarkerAnchor[] = [];
  pendingAnchors.forEach((anchor) => {
    // A worker-confirmed location at the same block replaces the provisional
    // green marker, including when the final colour changes to blue.
    const candidates = candidatesOverlappingRange(transaction.doc, anchor.from, anchor.to);
    const hasConfirmedReplacement = candidates.some((candidate) => currentRanges.has(`${candidate.position}:${candidate.position + candidate.node.nodeSize}`));
    if (hasConfirmedReplacement) return;
    candidates.forEach((candidate) => {
      const to = candidate.position + candidate.node.nodeSize;
      const range = `${candidate.position}:${to}`;
      if (currentRanges.has(range)) return;
      additions.push(gutterDecoration(candidate.position, candidate.node, anchor.id, anchor.kind));
      currentRanges.add(range);
    });
    retained.push(anchor);
  });
  return {
    decorations: additions.length > 0 ? build.decorations.add(transaction.doc, additions) : build.decorations,
    markerAnchors: [...build.markerAnchors, ...retained],
  } satisfies DecorationBuild;
}

export function createRevisionDecorationPlugin(onDeletedLocationClick: (locationId: string) => void) {
  let pendingMarkerSequence = 0;
  const nextPendingMarkerId = () => `revision-pending-empty-${pendingMarkerSequence++}`;
  return $prose(() => new Plugin<RevisionDecorationState>({
    key: revisionDecorationPluginKey,
    state: {
      init: (_config, state) => ({ enabled: false, locations: [], baselineKey: "", decorations: DecorationSet.create(state.doc, []), markerAnchors: [] }),
      apply: (transaction, previous) => {
        const config = transaction.getMeta(revisionDecorationPluginKey) as RevisionDecorationConfig | undefined;
        if (config) {
          const build = createRevisionDecorations(transaction.doc, config.enabled, config.locations, onDeletedLocationClick);
          const shouldRetainPending = config.enabled && previous.enabled && config.baselineKey === previous.baselineKey;
          return { ...config, ...(shouldRetainPending ? retainPendingEmptyMarkers(previous, transaction, build) : build) };
        }
        if (!transaction.docChanged) return previous;
        const mapped = preserveMappedMarkers(previous, transaction);
        return { ...previous, ...addPendingEmptyMarkers(mapped, transaction, nextPendingMarkerId) };
      },
    },
    props: {
      decorations: (state) => revisionDecorationPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  }));
}

export function setRevisionDecorations(enabled: boolean, locations: RevisionLocation[], baselineKey: string) {
  return { enabled, locations, baselineKey } satisfies RevisionDecorationConfig;
}

export function scrollToRevisionLocation(view: EditorView, locationId: string) {
  const element = view.dom.querySelector<HTMLElement>(`[data-revision-location="${locationId}"]`);
  element?.scrollIntoView({ block: "center", behavior: "auto" });
}
