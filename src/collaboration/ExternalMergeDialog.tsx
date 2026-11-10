import { useMemo, useState } from "react";
import { mergeMetadata, mergeResult, mergeText, type MergeChoice } from "./merge";
import "./collaboration.css";

export type MergeSnapshot = { content: string; metadata: string };
export type ExternalMergeInput = { documentId: string; path: string; revision: number; base: MergeSnapshot; local: MergeSnapshot; disk: MergeSnapshot };
export type ExternalMergeResult = { content: string; metadata: string };
const clean = (text: string) => {
  const value = JSON.parse(text);
  if (value.format) delete value.format.documentFingerprint;
  return value;
};
const labels = {
  zh: { title: "合并外部修改", description: "不重叠的修改会一起保留。冲突部分请逐项选择；合并后仍由你决定何时保存。", base: "共同版本", local: "我的修改", disk: "外部修改", localChoice: "保留我的", diskChoice: "采用外部", both: "保留双方", empty: "（空）", clean: "正文没有冲突，可以保留双方的修改。", settings: "格式或资源设置也有冲突", settingHelp: "选择这部分设置保留哪一版；未冲突的设置会一起保留。", preview: "查看合并后的 Markdown", cancel: "取消", apply: "应用到当前文稿", applying: "正在核对文件…" },
  en: { title: "Merge external changes", description: "Independent changes are kept together. Choose each conflicting change; saving remains your decision.", base: "Common version", local: "My changes", disk: "External changes", localChoice: "Keep mine", diskChoice: "Take external", both: "Keep both", empty: "(empty)", clean: "No text conflicts. Changes from both sides can be kept.", settings: "Formatting or resources also conflict", settingHelp: "Choose which version of these settings to keep. Independent settings are combined.", preview: "Preview merged Markdown", cancel: "Cancel", apply: "Apply to document", applying: "Checking the file…" },
};

export function ExternalMergeDialog({ input, language, onApply, onClose }: { input: ExternalMergeInput; language: "zh" | "en"; onApply: (input: ExternalMergeInput, result: ExternalMergeResult) => Promise<void>; onClose: () => void }) {
  const text = labels[language];
  const regions = useMemo(() => mergeText(input.base.content, input.local.content, input.disk.content), [input]);
  const [choices, setChoices] = useState<Record<string, MergeChoice>>({});
  const [settingChoice, setSettingChoice] = useState<MergeChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const metadata = useMemo(() => {
    const base = clean(input.base.metadata), local = clean(input.local.metadata), disk = clean(input.disk.metadata);
    const undecided = mergeMetadata(base, local, disk);
    const settingChoices = settingChoice ? Object.fromEntries(undecided.conflicts.map((conflict) => [JSON.stringify(conflict.path), settingChoice])) : {};
    return { ...mergeMetadata(base, local, disk, settingChoices), hasConflicts: undecided.conflicts.length > 0 };
  }, [input, settingChoice]);
  const result = mergeResult(regions, choices);
  const conflicts = regions.filter((region) => region.conflict);
  const apply = async () => {
    setBusy(true); setError(null);
    try { await onApply(input, { content: result.text, metadata: JSON.stringify(metadata.value) }); onClose(); }
    catch (error) { setError(String(error)); }
    finally { setBusy(false); }
  };
  return <div className="close-confirm-backdrop" role="presentation">
    <section className="external-merge-dialog" role="dialog" aria-modal="true" aria-labelledby="external-merge-title">
      <h2 id="external-merge-title">{text.title}</h2><p>{text.description}</p>
      <div className="external-merge-body">
        {!conflicts.length && <p className="merge-clean">{text.clean}</p>}
        {conflicts.map((region, index) => <section className="merge-conflict" key={region.id} aria-label={`${language === "zh" ? "冲突" : "Conflict"} ${index + 1}`}>
          <details><summary>{text.base}</summary><pre>{region.base || text.empty}</pre></details>
          <div className="merge-sides">{(["local", "disk"] as const).map((side) => <div key={side}><strong>{text[side]}</strong><pre>{region[side] || text.empty}</pre></div>)}</div>
          <div className="merge-choices">{(["local", "disk", "both"] as const).map((choice) => <button type="button" key={choice} aria-pressed={choices[region.id] === choice} onClick={() => setChoices((current) => ({ ...current, [region.id]: choice }))}>{choice === "local" ? text.localChoice : choice === "disk" ? text.diskChoice : text.both}</button>)}</div>
        </section>)}
        {metadata.hasConflicts && <section className="merge-conflict"><strong>{text.settings}</strong><p>{text.settingHelp}</p><div className="merge-choices">{(["local", "disk"] as const).map((choice) => <button type="button" key={choice} aria-pressed={settingChoice === choice} onClick={() => setSettingChoice(choice)}>{choice === "local" ? text.localChoice : text.diskChoice}</button>)}</div></section>}
        <details className="merge-preview"><summary>{text.preview}</summary><pre>{result.text}</pre></details>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="close-confirm-actions"><button type="button" disabled={busy} onClick={onClose}>{text.cancel}</button><button type="button" disabled={busy || result.unresolved > 0 || metadata.conflicts.length > 0} onClick={() => void apply()}>{busy ? text.applying : text.apply}</button></div>
    </section>
  </div>;
}
