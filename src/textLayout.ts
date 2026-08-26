import { $prose } from "@milkdown/utils";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@milkdown/prose/state";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { createFormatAnchor, resolveFormatAnchor, type DocumentFormatSettings, type TextAlignment, type TextFormatEntry, type TextLayoutSetting } from "./formatTypes";

export type { TextAlignment } from "./formatTypes";
export type TextLayout = TextLayoutSetting;
export type TextLayoutAction =
  | { type: "alignment"; value: TextAlignment }
  | { type: "first-line-indent" };

type TextLayoutState = {
  defaultLayout: TextLayout;
  layouts: Record<number, TextLayout>;
};
type TextBlock = { position: number };
type TextLayoutChange = { position: number; layout: TextLayout };
type TextDefaultChange = { firstLineIndent: boolean };

const standardTextLayout: TextLayout = { alignment: "left", firstLineIndent: false };
const layoutMarkerPattern = /^<!--\s*hakurou-layout:align=(left|center|right)(?:;indent=\d+)?(?:;first-line-indent=(0|1))?\s*-->$/;

export const textLayoutPluginKey = new PluginKey<TextLayoutState>("hakurou-text-layout");

function isDefaultLayout(layout: TextLayout, defaultLayout = standardTextLayout) {
  return layout.alignment === defaultLayout.alignment && layout.firstLineIndent === defaultLayout.firstLineIndent;
}

function layoutFromMarker(node: ProseNode): TextLayout | null {
  let layout: TextLayout | null = null;
  node.descendants((child) => {
    if (child.type.name !== "html") return;
    const match = String(child.attrs.value ?? "").match(layoutMarkerPattern);
    if (match) layout = { alignment: match[1] as TextAlignment, firstLineIndent: match[2] === "1" };
  });
  return layout;
}

function findLayoutMarker(doc: ProseNode, blockPosition: number) {
  const $block = doc.resolve(blockPosition);
  const index = $block.index($block.depth);
  if (index === 0) return null;
  return layoutFromMarker($block.node($block.depth).child(index - 1));
}

function isSupportedTextBlock(node: ProseNode) {
  return (node.type.name === "paragraph" || node.type.name === "heading") && !layoutFromMarker(node);
}

function selectedTextBlocks(state: EditorState): TextBlock[] {
  const { from, to } = state.selection;
  const blocks: TextBlock[] = [];
  state.doc.descendants((node, position) => {
    if (isSupportedTextBlock(node) && position < to && position + node.nodeSize > from) blocks.push({ position });
  });
  return blocks;
}

function textBlockAtPosition(doc: ProseNode, position: number) {
  const blocks: TextBlock[] = [];
  doc.descendants((node, nodePosition) => {
    if (!isSupportedTextBlock(node) || nodePosition >= position || position >= nodePosition + node.nodeSize) return;
    blocks.push({ position: nodePosition });
    return false;
  });
  return blocks[0] ?? null;
}

function defaultLayoutForNode(node: ProseNode, defaultLayout: TextLayout) {
  return node.type.name === "paragraph" && node.textContent.trim() ? defaultLayout : standardTextLayout;
}

function hydrateTextLayouts(doc: ProseNode, entries: TextFormatEntry[], defaultLayout: TextLayout) {
  const layouts: Record<number, TextLayout> = {};
  doc.descendants((node, position) => {
    if (!isSupportedTextBlock(node)) return;
    const legacyLayout = findLayoutMarker(doc, position);
    if (legacyLayout && !isDefaultLayout(legacyLayout, defaultLayoutForNode(node, defaultLayout))) layouts[position] = legacyLayout;
  });
  entries.forEach((entry) => {
    const position = resolveFormatAnchor(doc, entry.anchor);
    const node = position === null ? null : doc.nodeAt(position);
    if (node && isSupportedTextBlock(node) && !isDefaultLayout(entry.layout, defaultLayoutForNode(node, defaultLayout))) layouts[position!] = entry.layout;
  });
  return layouts;
}

function mapTextLayouts(transaction: Transaction, layouts: Record<number, TextLayout>) {
  return Object.entries(layouts).reduce<Record<number, TextLayout>>((mapped, [position, layout]) => {
    const result = transaction.mapping.mapResult(Number(position), 1);
    const node = !result.deleted ? transaction.doc.nodeAt(result.pos) : null;
    if (node && isSupportedTextBlock(node)) mapped[result.pos] = layout;
    return mapped;
  }, {});
}

function createTextLayoutDecorations(state: EditorState, textState: TextLayoutState) {
  const decorations: Decoration[] = [];
  state.doc.descendants((node, position) => {
    if (!isSupportedTextBlock(node)) return;
    const layout = textState.layouts[position] ?? defaultLayoutForNode(node, textState.defaultLayout);
    if (isDefaultLayout(layout)) return;
    decorations.push(Decoration.node(position, position + node.nodeSize, {
      class: [
        `hakurou-text-align-${layout.alignment}`,
        layout.firstLineIndent && "hakurou-text-first-line-indent",
      ].filter(Boolean).join(" "),
    }));
  });
  return DecorationSet.create(state.doc, decorations);
}

export function createTextLayoutPlugin(initialSettings: DocumentFormatSettings, defaultFirstLineIndent = false) {
  const defaultLayout: TextLayout = { alignment: "left", firstLineIndent: defaultFirstLineIndent };
  return $prose(() => new Plugin<TextLayoutState>({
    key: textLayoutPluginKey,
    state: {
      init: (_config, state) => ({ defaultLayout, layouts: hydrateTextLayouts(state.doc, initialSettings.text, defaultLayout) }),
      apply: (transaction, textState) => {
        const changes = transaction.getMeta(textLayoutPluginKey) as TextLayoutChange[] | undefined;
        const defaultChange = transaction.getMeta(textDefaultLayoutPluginKey) as TextDefaultChange | undefined;
        if (!transaction.docChanged && !changes && !defaultChange) return textState;
        const layouts = transaction.docChanged ? mapTextLayouts(transaction, textState.layouts) : { ...textState.layouts };
        changes?.forEach((change) => {
          const node = transaction.doc.nodeAt(change.position);
          const defaultForNode = node ? defaultLayoutForNode(node, defaultChange ? { alignment: "left", firstLineIndent: defaultChange.firstLineIndent } : textState.defaultLayout) : textState.defaultLayout;
          if (isDefaultLayout(change.layout, defaultForNode)) delete layouts[change.position];
          else layouts[change.position] = change.layout;
        });
        return { defaultLayout: defaultChange ? { alignment: "left", firstLineIndent: defaultChange.firstLineIndent } : textState.defaultLayout, layouts };
      },
    },
    props: {
      decorations: (state) => createTextLayoutDecorations(state, textLayoutPluginKey.getState(state) ?? { defaultLayout, layouts: {} }),
    },
  }));
}

export function collectTextFormatEntries(state: EditorState): TextFormatEntry[] {
  const textState = textLayoutPluginKey.getState(state);
  const layouts = textState?.layouts ?? {};
  const defaultLayout = textState?.defaultLayout ?? standardTextLayout;
  return Object.entries(layouts).flatMap(([position, layout]) => {
    const anchor = createFormatAnchor(state.doc, "text", Number(position));
    const node = state.doc.nodeAt(Number(position));
    return anchor && node && !isDefaultLayout(layout, defaultLayoutForNode(node, defaultLayout)) ? [{ anchor, layout }] : [];
  });
}

export function getSelectedTextLayout(state: EditorState) {
  const blocks = selectedTextBlocks(state);
  if (blocks.length === 0) return null;
  const textState = textLayoutPluginKey.getState(state);
  const layouts = textState?.layouts ?? {};
  const defaultLayout = textState?.defaultLayout ?? standardTextLayout;
  const firstNode = state.doc.nodeAt(blocks[0]!.position);
  const first = layouts[blocks[0]!.position] ?? (firstNode ? defaultLayoutForNode(firstNode, defaultLayout) : standardTextLayout);
  return blocks.every((block) => {
    const node = state.doc.nodeAt(block.position);
    const layout = layouts[block.position] ?? (node ? defaultLayoutForNode(node, defaultLayout) : standardTextLayout);
    return layout.alignment === first.alignment && layout.firstLineIndent === first.firstLineIndent;
  }) ? first : null;
}

function updateTextBlockLayouts(state: EditorState, blocks: TextBlock[], action: TextLayoutAction) {
  if (blocks.length === 0) return null;
  const textState = textLayoutPluginKey.getState(state);
  const layouts = textState?.layouts ?? {};
  const defaultLayout = textState?.defaultLayout ?? standardTextLayout;
  const changes = blocks.flatMap((block) => {
    const node = state.doc.nodeAt(block.position);
    const current = layouts[block.position] ?? (node ? defaultLayoutForNode(node, defaultLayout) : standardTextLayout);
    const layout: TextLayout = action.type === "alignment"
      ? { ...current, alignment: action.value }
      : { ...current, firstLineIndent: !current.firstLineIndent };
    return layout.alignment === current.alignment && layout.firstLineIndent === current.firstLineIndent
      ? []
      : [{ position: block.position, layout }];
  });
  return changes.length > 0 ? state.tr.setMeta(textLayoutPluginKey, changes satisfies TextLayoutChange[]) : null;
}

export function updateSelectedTextLayout(state: EditorState, action: TextLayoutAction) {
  return updateTextBlockLayouts(state, selectedTextBlocks(state), action);
}

export function getImageAlignment(state: EditorState, imagePosition: number): TextAlignment {
  const block = textBlockAtPosition(state.doc, imagePosition);
  const textState = textLayoutPluginKey.getState(state);
  const node = block ? state.doc.nodeAt(block.position) : null;
  return block ? textState?.layouts[block.position]?.alignment ?? (node ? defaultLayoutForNode(node, textState?.defaultLayout ?? standardTextLayout).alignment : standardTextLayout.alignment) : standardTextLayout.alignment;
}

export function updateImageAlignment(state: EditorState, imagePosition: number, alignment: TextAlignment) {
  const block = textBlockAtPosition(state.doc, imagePosition);
  if (!block) return null;
  const transaction = updateTextBlockLayouts(state, [block], { type: "alignment", value: alignment });
  return transaction ? { transaction, imagePosition } : null;
}

export const textDefaultLayoutPluginKey = new PluginKey<TextDefaultChange>("hakurou-text-default-layout");

export function setTextDefaultFirstLineIndent(firstLineIndent: boolean) {
  return { firstLineIndent } satisfies TextDefaultChange;
}
