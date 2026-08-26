import { tauriCapabilities } from "../capabilities";
import type { PlatformServices } from "../types";
import { tauriAssets } from "./assets";
import { tauriDialogs } from "./dialogs";
import { tauriFiles } from "./files";
import { tauriWindow } from "./window";

export const tauriPlatform: PlatformServices = {
  capabilities: tauriCapabilities,
  files: tauriFiles,
  dialogs: tauriDialogs,
  assets: tauriAssets,
  window: tauriWindow,
};
