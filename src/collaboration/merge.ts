import { sequenceChanges, type SequenceChange } from "./sequenceChanges";

export type MergeChoice = "local" | "disk" | "both";
export type MergeRegion = { id: string; base: string; local: string; disk: string; conflict: boolean; text: string };
const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

function edited(base: string[], from: number, to: number, edits: SequenceChange<string>[]) {
  let at = from, out = "";
  for (const edit of edits) { out += base.slice(at, edit.from).join("") + edit.insert.join(""); at = edit.to; }
  return out + base.slice(at, to).join("");
}

/** Three-way line merge. Ambiguous edits remain explicit conflicts, never guessed. */
export function mergeText(baseText: string, localText: string, diskText: string): MergeRegion[] {
  const base = lines(baseText);
  const edits = [
    ...sequenceChanges(base, lines(localText)).map((edit) => ({ ...edit, side: "local" as const })),
    ...sequenceChanges(base, lines(diskText)).map((edit) => ({ ...edit, side: "disk" as const })),
  ].sort((a, b) => a.from - b.from || a.to - b.to);
  const regions: MergeRegion[] = [];
  let at = 0, cursor = 0;
  const add = (base: string, local: string, disk: string, conflict: boolean, text: string) => regions.push({ id: `region-${regions.length}`, base, local, disk, conflict, text });
  while (cursor < edits.length) {
    const first = edits[cursor++]!;
    const from = first.from;
    let to = first.to;
    const group = [first];
    while (cursor < edits.length) {
      const next = edits[cursor]!;
      // Adjacent replacements are independent; an insertion at either edge is
      // kept with the replacement, where its intended ordering can be ambiguous.
      if (!(next.from < to || (next.from === to && (next.from === next.to || from === to)))) break;
      group.push(next); cursor++; to = Math.max(to, next.to);
    }
    const untouched = base.slice(at, from).join("");
    if (untouched) add(untouched, untouched, untouched, false, untouched);
    const ours = group.filter((edit) => edit.side === "local"), theirs = group.filter((edit) => edit.side === "disk");
    const original = base.slice(from, to).join("");
    const local = edited(base, from, to, ours), disk = edited(base, from, to, theirs);
    const conflict = !!ours.length && !!theirs.length && local !== disk;
    add(original, local, disk, conflict, ours.length ? local : disk);
    at = to;
  }
  const rest = base.slice(at).join("");
  if (rest || !regions.length) add(rest, rest, rest, false, rest);
  return regions;
}

export function mergeResult(regions: MergeRegion[], choices: Record<string, MergeChoice>): { text: string; unresolved: number } {
  let unresolved = 0;
  const text = regions.map((region) => {
    if (!region.conflict) return region.text;
    const choice = choices[region.id];
    if (!choice) { unresolved++; return region.local; }
    if (choice !== "both") return region[choice];
    const ending = /\r\n/.test(region.local + region.disk + region.base) ? "\r\n" : "\n";
    return region.local + (region.local && region.disk && !region.local.endsWith("\n") ? ending : "") + region.disk;
  }).join("");
  return { text, unresolved };
}

export type MetadataConflict = { path: string[]; base: unknown; local: unknown; disk: unknown };
const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, ordered(value[key])])) : value;
const same = (a: unknown, b: unknown) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export function metadataEquivalent(left: string, right: string) {
  const clean = (text: string) => { const value = JSON.parse(text); if (value.format) delete value.format.documentFingerprint; return value; };
  return same(clean(left), clean(right));
}

/** Merge sidecar fields independently, keeping resource arrays atomic on conflict. */
export function mergeMetadata(base: unknown, local: unknown, disk: unknown, choices: Record<string, MergeChoice> = {}) {
  const conflicts: MetadataConflict[] = [];
  const visit = (base: unknown, local: unknown, disk: unknown, path: string[]): unknown => {
    if (same(local, disk) || same(base, disk)) return local;
    if (same(base, local)) return disk;
    if (record(local) && record(disk) && (record(base) || base === undefined)) {
      const out: Record<string, unknown> = {};
      for (const key of new Set([...Object.keys(record(base) ? base : {}), ...Object.keys(local), ...Object.keys(disk)])) {
        const value = visit(record(base) ? base[key] : undefined, local[key], disk[key], [...path, key]);
        if (value !== undefined) out[key] = value;
      }
      return out;
    }
    const key = JSON.stringify(path);
    const choice = choices[key];
    if (!choice || choice === "both") conflicts.push({ path, base, local, disk });
    return choice === "disk" ? disk : local;
  };
  return { value: visit(base, local, disk, []), conflicts };
}
