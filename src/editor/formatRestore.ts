import { PluginKey } from "@milkdown/prose/state";
import type { DocumentFormatSettings } from "../formatTypes";

/** Hydrate sidecar decorations in the same applied transaction batch as text. */
export const formatRestoreKey = new PluginKey<{
  settings: DocumentFormatSettings;
  tableStyle: "standard" | "three-line";
  firstLineIndent: boolean;
}>("hakurou-format-restore");
