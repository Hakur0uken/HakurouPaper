import { $prose } from "@milkdown/utils";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Plugin, PluginKey } from "@milkdown/prose/state";
import { Decoration, DecorationSet, type EditorView } from "@milkdown/prose/view";
import type { RevisionBlockAnchor, RevisionLocation } from "./features/version-control/revisionTypes";

type RevisionDecorationConfig = { enabled: boolean; locations: RevisionLocation[] };
type RevisionDecorationState = RevisionDecorationConfig & { decorations: DecorationSet };
type Candidate = { position: number; index: number; node: ProseNode };

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

function topLevelCandidates(doc: ProseNode): Candidate[] {
  const candidates: Candidate[] = [];
  doc.forEach((node, position, index) => candidates.push({ node, position, index }));
  return candidates;
}

function candidateForAnchor(candidates: Candidate[], anchor: RevisionBlockAnchor | undefined) {
  if (!anchor) return undefined;
  const anchorText = normalized(anchor.text);
  const anchorImage = anchor.imageUrl ? normalized(anchor.imageUrl) : undefined;
  const exact = candidates.find((candidate) => {
    if (proseBlockKind(candidate.node) !== anchor.blockKind) return false;
    if (anchorImage && imageSource(candidate.node) === anchor.imageUrl) return true;
    return anchorText.length > 0 && normalized(candidate.node.textContent) === anchorText;
  });
  if (exact) return exact;
  if (anchor.blockIndex !== undefined) return candidates[anchor.blockIndex];
  return candidates.find((candidate) => {
    if (anchorImage && normalized(imageSource(candidate.node) ?? "") === anchorImage) return true;
    return anchorText.length > 0 && normalized(candidate.node.textContent) === anchorText;
  });
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

function createRevisionDecorations(doc: ProseNode, enabled: boolean, locations: RevisionLocation[], onDeletedLocationClick: (locationId: string) => void) {
  if (!enabled || locations.length === 0) return DecorationSet.empty;
  const candidates = topLevelCandidates(doc);
  const decorations: Decoration[] = [];
  const occupiedPositions = new Set<number>();
  locations.forEach((location) => {
    const candidate = candidateForAnchor(candidates, location.kind === "removed" ? location.editorAnchor : location.anchorAfter);
    const position = candidate?.position ?? doc.content.size;
    if (location.kind === "removed") {
      decorations.push(Decoration.widget(position, () => markerElement(location, onDeletedLocationClick), { key: location.id, side: -1 }));
      return;
    }
    if (!candidate) return;
    if (occupiedPositions.has(position)) return;
    occupiedPositions.add(position);
    decorations.push(Decoration.node(position, position + candidate.node.nodeSize, {
      class: `hakurou-revision-gutter is-${location.kind}`,
      "data-revision-location": location.id,
    }));
  });
  return DecorationSet.create(doc, decorations);
}

export function createRevisionDecorationPlugin(onDeletedLocationClick: (locationId: string) => void) {
  return $prose(() => new Plugin<RevisionDecorationState>({
    key: revisionDecorationPluginKey,
    state: {
      init: (_config, state) => ({ enabled: false, locations: [], decorations: DecorationSet.create(state.doc, []) }),
      apply: (transaction, previous) => {
        const config = transaction.getMeta(revisionDecorationPluginKey) as RevisionDecorationConfig | undefined;
        if (config) return {
          ...config,
          decorations: createRevisionDecorations(transaction.doc, config.enabled, config.locations, onDeletedLocationClick),
        };
        if (!transaction.docChanged) return previous;
        return { ...previous, decorations: previous.decorations.map(transaction.mapping, transaction.doc) };
      },
    },
    props: {
      decorations: (state) => revisionDecorationPluginKey.getState(state)?.decorations ?? DecorationSet.empty,
    },
  }));
}

export function setRevisionDecorations(enabled: boolean, locations: RevisionLocation[]) {
  return { enabled, locations } satisfies RevisionDecorationConfig;
}

export function scrollToRevisionLocation(view: EditorView, locationId: string) {
  const element = view.dom.querySelector<HTMLElement>(`[data-revision-location="${locationId}"]`);
  element?.scrollIntoView({ block: "center", behavior: "auto" });
}
