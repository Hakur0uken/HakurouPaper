import { Plugin, PluginKey, Selection, type Transaction } from "@milkdown/prose/state";
import { Step, StepMap, StepResult } from "@milkdown/prose/transform";
import { closeHistory, undo, redo } from "@milkdown/prose/history";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { EditorView } from "@milkdown/prose/view";
import { sourceSnapshot, rewriteSource, reuseSourceNodes, type ParseMarkdown, type SerializeMarkdown, type SourceSnapshot } from "./sourceMirror";

const exactSource = "hakurou.exactSource";
const recordedSource = "hakurou.recordedSource";
/** A reversible source-only step keeps spelling, blank lines and BOM in the
 * same undo event as the ProseMirror edit, without adding private document nodes. */
class SourceStep extends Step {
  readonly from: number;
  readonly before: string;
  readonly after: string;
  constructor(before: string, after: string, readonly context?: { before: string; after: string }, from?: number) {
    super();
    if (from !== undefined) { this.from = from; this.before = before; this.after = after; return; }
    let start = 0, end = 0;
    while (start < before.length && start < after.length && before[start] === after[start]) start++;
    while (end < before.length - start && end < after.length - start && before[before.length - end - 1] === after[after.length - end - 1]) end++;
    this.from = start;
    this.before = before.slice(start, before.length - end);
    this.after = after.slice(start, after.length - end);
  }
  source(markdown: string) { return markdown.slice(0, this.from) + this.after + markdown.slice(this.from + this.before.length); }
  apply(doc: ProseNode) { return StepResult.ok(doc); }
  getMap() { return StepMap.empty; }
  invert() { return new SourceStep(this.after, this.before, this.context && { before: this.context.after, after: this.context.before }, this.from); }
  map() { return this; }
  toJSON() { return { stepType: "hakurou-source", from: this.from, before: this.before, after: this.after, context: this.context }; }
  static fromJSON(_schema: unknown, json: { from: number; before: string; after: string; context?: { before: string; after: string } }) { return new SourceStep(json.before, json.after, json.context, json.from); }
}
Step.jsonID("hakurou-source", SourceStep);

type State = { snapshot: SourceSnapshot; before?: string; context?: string; contextRevision: number };
export const sourceEditingKey = new PluginKey<State>("hakurou-source-editing");
export type LiveEditor = { read(): string; replace(markdown: string, context?: { before: string; after: string }): void; undo(): boolean; redo(): boolean; focus(): void };

export function createSourceEditing(initial: string, parse: ParseMarkdown, serialize: SerializeMarkdown, changed: (markdown: string) => void, ready: (editor: LiveEditor | null) => void, contextChanged?: (context: string) => void, restoreContext?: (transaction: Transaction, context: string) => Transaction) {
  return new Plugin<State>({
    key: sourceEditingKey,
    state: {
      init: (_, state) => ({ snapshot: sourceSnapshot(initial, state.doc, parse, serialize), contextRevision: 0 }),
      apply(tr, value) {
        const steps = tr.steps.filter((step): step is SourceStep => step instanceof SourceStep);
        if (steps.length) {
          // The appended recording step describes a source rewrite already
          // calculated above. History replay applies every compact patch in order.
          const markdown = tr.getMeta(recordedSource) ? value.snapshot.markdown : steps.reduce((text, step) => step.source(text), value.snapshot.markdown);
          const contexts = steps.flatMap((step) => step.context ? [step.context.after] : []);
          return { snapshot: markdown === value.snapshot.markdown
          ? { ...value.snapshot, doc: tr.doc }
          : sourceSnapshot(markdown, tr.doc, parse, serialize), context: contexts[contexts.length - 1] ?? value.context,
          contextRevision: value.contextRevision + contexts.length };
        }
        const exact = tr.getMeta(exactSource) as string | undefined;
        if (!tr.docChanged && exact === undefined) return value;
        const snapshot = exact === undefined ? rewriteSource(value.snapshot, tr.doc, parse, serialize) : sourceSnapshot(exact, tr.doc, parse, serialize);
        return { ...value, snapshot, before: value.before ?? (snapshot.markdown !== value.snapshot.markdown ? value.snapshot.markdown : undefined) };
      },
    },
    appendTransaction(transactions, _old, state) {
      const steps = transactions.flatMap((tr) => tr.steps).filter((step): step is SourceStep => step instanceof SourceStep);
      if (steps.length) {
        const context = [...steps].reverse().find((step) => step.context)?.context?.after;
        return context !== undefined && restoreContext ? restoreContext(state.tr.setMeta("addToHistory", false), context) : null;
      }
      const value = sourceEditingKey.getState(state)!;
      if (value.before === undefined || value.before === value.snapshot.markdown) return null;
      return state.tr.step(new SourceStep(value.before, value.snapshot.markdown)).setMeta(recordedSource, true);
    },
    view(view) {
      let last = initial;
      let contextRevision = 0;
      const notify = (view: EditorView) => {
        const state = sourceEditingKey.getState(view.state)!;
        const markdown = state.snapshot.markdown;
        if (markdown !== last) { last = markdown; changed(markdown); }
        if (state.contextRevision !== contextRevision) {
          contextRevision = state.contextRevision;
          if (state.context !== undefined) contextChanged?.(state.context);
        }
      };
      ready({
        read: () => sourceEditingKey.getState(view.state)!.snapshot.markdown,
        replace(markdown, context) {
          if (view.composing) throw new Error("请等输入法选字结束后再修改文稿。");
          // Parser defaults omit generated heading IDs and other transient
          // attributes. Reuse equivalent nodes so they do not widen the edit.
          const doc = reuseSourceNodes(view.state.doc, parse(markdown), serialize);
          let tr = closeHistory(view.state.tr);
          const start = tr.doc.content.findDiffStart(doc.content);
          if (start !== null) {
            const end = tr.doc.content.findDiffEnd(doc.content)!;
            const overlap = start - Math.min(end.a, end.b);
            tr = tr.replace(start, end.a + Math.max(0, overlap), doc.slice(start, end.b + Math.max(0, overlap)));
          }
          // Even a Markdown spelling-only edit needs a reversible history step.
          tr.setMeta(exactSource, markdown);
          if (context || (!tr.docChanged && markdown !== sourceEditingKey.getState(view.state)!.snapshot.markdown)) {
            tr.step(new SourceStep(sourceEditingKey.getState(view.state)!.snapshot.markdown, markdown, context));
          }
          // Transaction mapping keeps the selection outside replaced content;
          // a replaced selection lands at the nearest surviving valid position.
          if (tr.selection.from > tr.doc.content.size) tr.setSelection(Selection.atEnd(tr.doc));
          view.dispatch(tr);
          view.dispatch(closeHistory(view.state.tr));
          notify(view);
        },
        focus: () => view.focus(),
        undo: () => undo(view.state, view.dispatch),
        redo: () => redo(view.state, view.dispatch),
      });
      return { update: notify, destroy: () => ready(null) };
    },
  });
}
