import { open, save } from "@tauri-apps/plugin-dialog";
import type { DialogService } from "../types";

export const tauriDialogs: DialogService = {
  async openMarkdown({ title, filter }) {
    const result = await open({ title, multiple: false, filters: [filter] });
    return typeof result === "string" ? result : null;
  },
  async saveMarkdown({ title, defaultPath, filter }) {
    const result = await save({ title, defaultPath, filters: [filter] });
    return typeof result === "string" ? result : null;
  },
  async openFile({ title, filter }) {
    const result = await open({ title, multiple: false, filters: [filter] });
    return typeof result === "string" ? result : null;
  },
  async saveFile({ title, defaultPath, filter }) {
    const result = await save({ title, defaultPath, filters: [filter] });
    return typeof result === "string" ? result : null;
  },
  async selectDirectory({ title }) {
    const result = await open({ title, directory: true, multiple: false });
    return typeof result === "string" ? result : null;
  },
};
