import { useMemo, useState } from "react";
import { mergeText, mergeResult, mergeMetadata, type MergeChoice } from "../../collaboration/merge";
import type { RemoteMergeConflict, RemoteMergeFileVersions, RemoteMergeResolution } from "../../platform/remoteMergeTypes";
import type { RemoteMergeText } from "./mergeText";

function TextResolution({ versions, onChange, current, text }: { versions: RemoteMergeFileVersions; current?: RemoteMergeResolution; onChange: (value: string | null) => void; text: RemoteMergeText }) {
  const regions = useMemo(() => mergeText(versions.base.content ?? "", versions.local.content ?? "", versions.remote.content ?? ""), [versions]);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [custom, setCustom] = useState<string | null>(current?.choice === "text" ? current.text ?? "" : null);
  const result = mergeResult(regions, choices);
  const conflicts = regions.filter(r => r.conflict);
  return <div className="remote-text-resolution">
    <p>{conflicts.length ? text.textHelp : text.noTextConflicts}</p>
    {conflicts.map(region => <section className="merge-conflict" key={region.id}>
      <details><summary>{text.original}</summary><pre>{region.base || text.missing}</pre></details>
      <div className="merge-sides"><div><strong>{text.local}</strong><pre>{region.local || text.missing}</pre></div><div><strong>{text.remote}</strong><pre>{region.disk || text.missing}</pre></div></div>
      <div className="merge-choices">{(["local", "disk", "both"] as const).map(choice => <button type="button" key={choice} aria-pressed={custom === null && choices[region.id] === choice} onClick={() => { setChoices(v => ({ ...v, [region.id]: choice })); setCustom(null); onChange(null); }}>{choice === "local" ? text.localChoice : choice === "disk" ? text.remoteChoice : text.bothChoice}</button>)}</div>
    </section>)}
    <label className="remote-result-label">{text.finalText}<textarea spellCheck={false} value={custom ?? result.text} onChange={event => { setCustom(event.target.value); onChange(null); }} /></label>
    <button type="button" disabled={custom === null && result.unresolved > 0} onClick={() => onChange(custom ?? result.text)}>{text.useResult}</button>
  </div>;
}

function JsonResolution({ versions, onChange, text }: { versions: RemoteMergeFileVersions; onChange: (value: string | null) => void; text: RemoteMergeText }) {
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const source = useMemo(() => {
    const parse = (content: string | null) => {
      const value = JSON.parse(content ?? "{}");
      if (!value || typeof value !== "object" || Array.isArray(value) || ("schemaVersion" in value && value.schemaVersion !== 1)) throw new Error("Unknown settings schema");
      if (value.format && typeof value.format === "object") delete value.format.documentFingerprint;
      return value;
    };
    try { return { base: parse(versions.base.content), local: parse(versions.local.content), remote: parse(versions.remote.content) }; } catch { return null; }
  }, [versions]);
  if (!source) return <><p>{text.invalidMetadata}</p><TextResolution versions={versions} onChange={onChange} text={text} /></>;
  const undecided = mergeMetadata(source.base, source.local, source.remote);
  const merged = mergeMetadata(source.base, source.local, source.remote, choices);
  return <section className="remote-json-resolution"><h3>{text.metadata}</h3><p>{text.metadataHelp}</p>
    {undecided.conflicts.map(conflict => { const key = JSON.stringify(conflict.path); return <section className="merge-conflict" key={key}>
      <strong>{conflict.path.join(" / ")}</strong>
      <div className="merge-sides"><div><strong>{text.local}</strong><pre>{JSON.stringify(conflict.local, null, 2) ?? text.missing}</pre></div><div><strong>{text.remote}</strong><pre>{JSON.stringify(conflict.disk, null, 2) ?? text.missing}</pre></div></div>
      <div className="merge-choices">{(["local", "disk"] as const).map(choice => <button type="button" key={choice} aria-pressed={choices[key] === choice} onClick={() => { setChoices(c => ({ ...c, [key]: choice })); onChange(null); }}>{choice === "local" ? text.localChoice : text.remoteChoice}</button>)}</div>
    </section>; })}
    <details><summary>{text.inspectSettings}</summary><pre>{JSON.stringify(merged.value, null, 2)}</pre></details>
    <button type="button" disabled={merged.conflicts.length > 0} onClick={() => onChange(JSON.stringify(merged.value, null, 2) + "\n")}>{text.useResult}</button>
  </section>;
}

export function MergeResolutionEditor({ conflict, path, versions, current, onChange, text }: { conflict: RemoteMergeConflict; path: string; versions: RemoteMergeFileVersions; current?: RemoteMergeResolution; onChange: (resolution: RemoteMergeResolution | null) => void; text: RemoteMergeText }) {
  const editable = conflict.editable && [versions.base, versions.local, versions.remote].every(v => v.kind === "text" || v.kind === "missing") && (!versions.local.mode || !versions.remote.mode || versions.local.mode === versions.remote.mode);
  const structured = /(?:^|\/)hakurou\.json$/i.test(path) && versions.local.kind !== "missing" && versions.remote.kind !== "missing";
  return <section className="remote-resolution" aria-label={text.resolve}>
    {current && <p role="status" className="remote-resolved">{text.currentResult}</p>}
    <p>{conflict.paths.length > 1 ? text.groupHelp : text.wholeFile}</p>
    {conflict.paths.length > 1 && <ul>{conflict.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul>}
    <div className="merge-choices">{(["local", "remote"] as const).map(side => <button type="button" key={side} aria-pressed={current?.choice === side} onClick={() => onChange({ conflictId: conflict.id, choice: side })}>{side === "local" ? text.localChoice : text.remoteChoice}{conflict.paths.length === 1 && versions[side].kind === "missing" ? ` · ${text.deleteFile}` : ""}</button>)}</div>
    {editable && (structured ? <JsonResolution versions={versions} text={text} onChange={value => onChange(value === null ? null : { conflictId: conflict.id, choice: "text", text: value })} /> : <TextResolution versions={versions} current={current} text={text} onChange={value => onChange(value === null ? null : { conflictId: conflict.id, choice: "text", text: value })} />)}
  </section>;
}
