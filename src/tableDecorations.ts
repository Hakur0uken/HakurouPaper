import { $prose } from "@milkdown/utils";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { Decoration, DecorationSet } from "@milkdown/prose/view";
import { createFormatAnchor, resolveFormatAnchor, type DocumentFormatSettings, type TableDecorationSetting, type TableFormatEntry } from "./formatTypes";
import type { TableStyle } from "./appearanceSettings";

export type TableDecoration = TableDecorationSetting;

type TableDecorationState = {
  defaultDecoration: TableDecoration;
  decorations: Record<number, TableDecoration>;
};
type TableDecorationChange = { position: number; decoration: TableDecoration };
type TableDefaultChange = { defaultStyle: TableStyle };

const defaultTableDecoration: TableDecoration = { titleRow: true, titleColumn: false, threeLine: false };
const threeLineTableMarker = "<!-- hakurou-table:three-line -->";

export const tableDecorationPluginKey = new PluginKey<TableDecorationState>("hakurou-table-decoration");

function tableDecorationForStyle(style: TableStyle): TableDecoration {
  return style === "three-line"
    ? { ...defaultTableDecoration, threeLine: true }
    : { ...defaultTableDecoration };
}

function isDefaultTableDecoration(decoration: TableDecoration, defaultDecoration = defaultTableDecoration) {
  return decoration.titleRow === defaultDecoration.titleRow
    && decoration.titleColumn === defaultDecoration.titleColumn
    && decoration.threeLine === defaultDecoration.threeLine;
}

function tableClasses(decoration: TableDecoration) {
  return [
    !decoration.titleRow && "no-title-row",
    decoration.titleColumn && "has-title-column",
    decoration.threeLine && "is-three-line",
  ].filter(Boolean).join(" ");
}

function isThreeLineTableMarker(node: ProseNode) {
  let hasMarker = false;
  node.descendants((child) => {
    if (child.type.name === "html" && child.attrs.value === threeLineTableMarker) hasMarker = true;
  });
  return hasMarker;
}

function hasLegacyThreeLineMarker(doc: ProseNode, tablePosition: number) {
  const $table = doc.resolve(tablePosition);
  const index = $table.index($table.depth);
  return index > 0 && isThreeLineTableMarker($table.node($table.depth).child(index - 1));
}

function hydrateTableDecorations(doc: ProseNode, entries: TableFormatEntry[], defaultDecoration: TableDecoration) {
  const decorations: Record<number, TableDecoration> = {};
  doc.descendants((node, position) => {
    if (node.type.name === "table" && hasLegacyThreeLineMarker(doc, position)) decorations[position] = { ...defaultTableDecoration, threeLine: true };
  });
  entries.forEach((entry) => {
    const position = resolveFormatAnchor(doc, entry.anchor);
    if (position !== null && doc.nodeAt(position)?.type.name === "table" && !isDefaultTableDecoration(entry.decoration, defaultDecoration)) decorations[position] = entry.decoration;
  });
  return decorations;
}

function mapTableDecorations(transaction: Transaction, decorations: Record<number, TableDecoration>) {
  return Object.entries(decorations).reduce<Record<number, TableDecoration>>((mapped, [position, decoration]) => {
    const result = transaction.mapping.mapResult(Number(position), 1);
    if (!result.deleted && transaction.doc.nodeAt(result.pos)?.type.name === "table") mapped[result.pos] = decoration;
    return mapped;
  }, {});
}

function createTableDecorations(state: EditorState, tableState: TableDecorationState) {
  const result: Decoration[] = [];
  state.doc.descendants((node, position) => {
    if (node.type.name !== "table") return;
    const decoration = tableState.decorations[position] ?? tableState.defaultDecoration;
    const className = tableClasses(decoration);
    if (className) result.push(Decoration.node(position, position + node.nodeSize, { class: className }));
  });
  return DecorationSet.create(state.doc, result);
}

export function createTableDecorationPlugin(initialSettings: DocumentFormatSettings, defaultStyle: TableStyle = "standard") {
  const defaultDecoration = tableDecorationForStyle(defaultStyle);
  return $prose(() => new Plugin<TableDecorationState>({
    key: tableDecorationPluginKey,
    state: {
      init: (_config, state) => ({ defaultDecoration, decorations: hydrateTableDecorations(state.doc, initialSettings.tables, defaultDecoration) }),
      apply: (transaction, tableState) => {
        const changes = transaction.getMeta(tableDecorationPluginKey) as TableDecorationChange[] | undefined;
        const defaultChange = transaction.getMeta(tableDefaultStylePluginKey) as TableDefaultChange | undefined;
        if (!transaction.docChanged && !changes && !defaultChange) return tableState;
        const decorations = transaction.docChanged ? mapTableDecorations(transaction, tableState.decorations) : { ...tableState.decorations };
        changes?.forEach((change) => {
          if (isDefaultTableDecoration(change.decoration, tableState.defaultDecoration)) delete decorations[change.position];
          else decorations[change.position] = change.decoration;
        });
        return { defaultDecoration: defaultChange ? tableDecorationForStyle(defaultChange.defaultStyle) : tableState.defaultDecoration, decorations };
      },
    },
    props: {
      decorations: (state) => createTableDecorations(state, tableDecorationPluginKey.getState(state) ?? { defaultDecoration, decorations: {} }),
    },
  }));
}

export function collectTableFormatEntries(state: EditorState): TableFormatEntry[] {
  const tableState = tableDecorationPluginKey.getState(state);
  const decorations = tableState?.decorations ?? {};
  const defaultDecoration = tableState?.defaultDecoration ?? defaultTableDecoration;
  return Object.entries(decorations).flatMap(([position, decoration]) => {
    const anchor = createFormatAnchor(state.doc, "table", Number(position));
    return anchor && !isDefaultTableDecoration(decoration, defaultDecoration) ? [{ anchor, decoration }] : [];
  });
}

export function getTableDecoration(position: number, state: EditorState) {
  const tableState = tableDecorationPluginKey.getState(state);
  return tableState?.decorations[position] ?? tableState?.defaultDecoration ?? defaultTableDecoration;
}

export function setTableDecoration(position: number, decoration: TableDecoration) {
  return [{ position, decoration }] satisfies TableDecorationChange[];
}

export function toggleThreeLineTable(state: EditorState, position: number) {
  const decoration = getTableDecoration(position, state);
  return {
    transaction: state.tr.setMeta(tableDecorationPluginKey, [{ position, decoration: { ...decoration, threeLine: !decoration.threeLine } } satisfies TableDecorationChange]),
    tablePosition: position,
  };
}

export const tableDefaultStylePluginKey = new PluginKey<TableDefaultChange>("hakurou-table-default-style");

export function setTableDefaultStyle(style: TableStyle) {
  return { defaultStyle: style } satisfies TableDefaultChange;
}
