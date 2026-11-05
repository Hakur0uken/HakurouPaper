import { getVersion } from "@tauri-apps/api/app";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { gt, valid } from "semver";
import { relaunch } from "@tauri-apps/plugin-process";
import { parseLatestRelease, releaseApi, releasePage } from "../../features/software-update/release";
import type { SoftwareUpdateService } from "../updateTypes";
import { tauriLinks } from "./links";

export const tauriUpdates: SoftwareUpdateService = {
  async check() {
    const currentVersion = await getVersion();
    let checkedUpdate: Update | null;
    try {
      // The static manifest avoids GitHub API rate limits for normal updates.
      checkedUpdate = await check({ timeout: 20_000 });
    } catch {
      // Bootstrap older releases which have no signed update manifest.
      const response = await fetch(releaseApi, {
        headers: { Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer",
      });
      if (!response.ok) throw new Error("Release check failed");
      const latest = parseLatestRelease(await response.json(), currentVersion);
      if (!latest) return { currentVersion, update: null };
      if (!latest.hasManifest) return {
        currentVersion,
        update: {
          ...latest, kind: "manual",
          download: async () => { throw new Error("This release requires manual installation"); },
          install: async () => { throw new Error("This release requires manual installation"); },
          close: async () => {},
        },
      };
      // A published manifest that fails to load/validate must not silently
      // become an unverified in-app installer.
      throw new Error("Signed update check failed");
    }
    const update = checkedUpdate;
    if (!update) return { currentVersion, update: null };
    if (!valid(update.version) || !gt(update.version, currentVersion)) {
      await update.close();
      throw new Error("Invalid update version");
    }
    return {
      currentVersion,
      update: {
        version: update.version, notes: update.body?.slice(0, 20_000) ?? "", date: update.date, kind: "in-app",
        async download(onProgress) {
          let downloaded = 0;
          let total: number | undefined;
          await update.download((event) => {
            if (event.event === "Started") { downloaded = 0; total = event.data.contentLength; }
            if (event.event === "Progress") downloaded += event.data.chunkLength;
            onProgress({ downloaded, total });
          }, { timeout: 300_000 });
        },
        async install() {
          // Windows exits here and the installer restarts the app. Other desktop
          // platforms return from installation and need an explicit relaunch.
          await update.install();
          await relaunch();
        },
        close: () => update.close(),
      },
    };
  },
  openReleasePage: () => tauriLinks.openExternal(releasePage),
};
