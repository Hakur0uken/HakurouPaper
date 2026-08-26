import type { EditorState } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import { emptyDocumentFormatSettings, resolveFormatAnchor, type DocumentFormatDefaults, type DocumentFormatSettings } from "./formatTypes";
import { collectTableFormatEntries, tableDecorationPluginKey } from "./tableDecorations";
import { collectTextFormatEntries, textLayoutPluginKey } from "./textLayout";

export function collectDocumentFormatSettings(state: EditorState, unresolved = emptyDocumentFormatSettings(), defaults: DocumentFormatDefaults = unresolved.defaults): DocumentFormatSettings {
  return {
    ...emptyDocumentFormatSettings(),
    defaults,
    text: [...collectTextFormatEntries(state), ...unresolved.text],
    tables: [...collectTableFormatEntries(state), ...unresolved.tables],
  };
}

export function collectUnresolvedDocumentFormatSettings(doc: ProseNode, settings: DocumentFormatSettings): DocumentFormatSettings {
  return {
    ...emptyDocumentFormatSettings(),
    defaults: settings.defaults,
    text: settings.text.filter((entry) => resolveFormatAnchor(doc, entry.anchor) === null),
    tables: settings.tables.filter((entry) => resolveFormatAnchor(doc, entry.anchor) === null),
  };
}

export function documentFormattingChanged(previous: EditorState, next: EditorState) {
  return textLayoutPluginKey.getState(previous) !== textLayoutPluginKey.getState(next)
    || tableDecorationPluginKey.getState(previous) !== tableDecorationPluginKey.getState(next);
}
