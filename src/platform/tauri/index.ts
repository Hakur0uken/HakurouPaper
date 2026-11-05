import { tauriCapabilities } from "../capabilities";
import type { PlatformServices } from "../types";
import { tauriAssets } from "./assets";
import { tauriDialogs } from "./dialogs";
import { tauriFiles } from "./files";
import { tauriVersionControl } from "./git";
import { tauriRemoteGit } from "./remoteGit";
import { tauriLinks } from "./links";
import { tauriWindow } from "./window";
import { tauriUpdates } from "./updates";

export const tauriPlatform: PlatformServices = {
  capabilities: tauriCapabilities,
  files: tauriFiles,
  dialogs: tauriDialogs,
  assets: tauriAssets,
  window: tauriWindow,
  links: tauriLinks,
  versionControl: tauriVersionControl,
  remoteGit: tauriRemoteGit,
  updates: tauriUpdates,
};
