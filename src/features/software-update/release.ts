import { gt, valid } from "semver";
export const releasePage = "https://github.com/Hakur0uken/HakurouPaper/releases/latest";
export const releaseApi = "https://api.github.com/repos/Hakur0uken/HakurouPaper/releases/latest";

/** GitHub metadata also supports releases that predate the signed manifest. */
export function parseLatestRelease(value: unknown, currentVersion: string) {
  if (!valid(currentVersion) || !value || typeof value !== "object") throw new Error("Invalid release metadata");
  const release = value as Record<string, unknown>;
  const version = typeof release.tag_name === "string" ? valid(release.tag_name) : null;
  if (!version || release.draft !== false || release.prerelease !== false || !Array.isArray(release.assets)) throw new Error("Invalid release metadata");
  if (!gt(version, currentVersion)) return null;
  return {
    version,
    notes: typeof release.body === "string" ? release.body.slice(0, 20_000) : "",
    date: typeof release.published_at === "string" ? release.published_at : undefined,
    hasManifest: release.assets.some((asset) => asset && typeof asset === "object" && asset.name === "latest.json" && asset.state === "uploaded"),
  };
}
