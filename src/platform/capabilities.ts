import type { PlatformCapabilities } from "./types";

export const tauriCapabilities: PlatformCapabilities = {
  richClipboard: true,
  vectorClipboard: true,
  externalProcesses: true,
  directoryProjects: true,
  // Kept as a legacy capability. Whether Git exists is checked at runtime.
  nativeGit: false,
  docxExport: true,
  filesystemWatch: false,
  multiWindow: true,
};
