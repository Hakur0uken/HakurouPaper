import type { PlatformCapabilities } from "./types";

export const tauriCapabilities: PlatformCapabilities = {
  richClipboard: true,
  vectorClipboard: true,
  externalProcesses: false,
  directoryProjects: true,
  nativeGit: false,
  docxExport: false,
  filesystemWatch: false,
  multiWindow: true,
};
