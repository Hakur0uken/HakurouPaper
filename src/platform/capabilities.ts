import type { PlatformCapabilities } from "./types";

export const tauriCapabilities: PlatformCapabilities = {
  richClipboard: true,
  vectorClipboard: true,
  externalProcesses: true,
  directoryProjects: true,
  nativeGit: false,
  docxExport: true,
  filesystemWatch: false,
  multiWindow: true,
};
