export type UpdateProgress = { downloaded: number; total?: number };
export type SoftwareUpdateInfo = { version: string; notes: string; date?: string; kind: "in-app" | "manual" };
export type SoftwareUpdate = SoftwareUpdateInfo & {
  download: (onProgress: (progress: UpdateProgress) => void) => Promise<void>;
  install: () => Promise<void>;
  close: () => Promise<void>;
};
export type SoftwareUpdateService = {
  check: () => Promise<{ currentVersion: string; update: SoftwareUpdate | null }>;
  openReleasePage: () => Promise<void>;
};
