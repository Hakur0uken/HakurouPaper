import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { WindowService } from "../types";

export const tauriWindow: WindowService = {
  minimize() {
    return getCurrentWindow().minimize();
  },
  async toggleMaximize() {
    const appWindow = getCurrentWindow();
    if (await appWindow.isMaximized()) await appWindow.unmaximize();
    else await appWindow.maximize();
  },
  requestClose() {
    return invoke("close_application");
  },
  startDragging() {
    return getCurrentWindow().startDragging();
  },
  onCloseRequested(listener) {
    return getCurrentWindow().onCloseRequested((event) => {
      event.preventDefault();
      listener();
    });
  },
};
