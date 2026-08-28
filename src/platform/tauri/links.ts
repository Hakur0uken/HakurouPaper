import { openUrl } from "@tauri-apps/plugin-opener";
import type { LinkService } from "../types";

export const tauriLinks: LinkService = {
  openExternal(url) {
    return openUrl(url);
  },
};
