import { parserCtx } from "@milkdown/core";
import { Slice } from "@milkdown/prose/model";
import { Plugin } from "@milkdown/prose/state";
import { isInTable } from "@milkdown/prose/tables";
import { $prose } from "@milkdown/utils";

const markdownTableDelimiter = /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const blockMath = /(?:^|\n)[\t ]*\$\$[\s\S]*?\$\$[\t ]*(?=\n|$)/;
const bracketBlockMath = /(?:^|\n)[\t ]*\\\[[\s\S]*?\\\][\t ]*(?=\n|$)/;
const inlineMath = /(^|[^\\$])\$[^$\n]+\$(?!\$)/;

function containsMarkdownTable(text: string) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  return lines.some((line, index) => (
    line.includes("|") && Boolean(lines[index + 1] && markdownTableDelimiter.test(lines[index + 1]))
  ));
}

function containsStructuredMarkdown(text: string) {
  return containsMarkdownTable(text)
    || blockMath.test(text)
    || bracketBlockMath.test(text)
    // Keep a one-off inline formula on the dedicated inline paste path below,
    // but parse a multi-line Markdown fragment as a whole so its headings and
    // paragraphs do not become raw text around the formula.
    || (text.includes("\n") && inlineMath.test(text));
}

/**
 * Turns pasted Markdown that carries block structure into Milkdown nodes. The
 * default ProseMirror plain-text path only inserts characters, so GFM tables
 * and block formulas would otherwise remain ordinary paragraphs.
 */
export const markdownPastePlugin = $prose((ctx) => new Plugin({
  props: {
    handlePaste(view, event) {
      if (isInTable(view.state)) return false;

      const text = event.clipboardData?.getData("text/plain");
      if (!text || !containsStructuredMarkdown(text)) return false;

      const document = ctx.get(parserCtx)(text);
      if (!document) return false;

      const selectedContent = view.state.selection.content();
      event.preventDefault();
      view.dispatch(view.state.tr
        .replaceSelection(new Slice(document.content, selectedContent.openStart, selectedContent.openEnd))
        .scrollIntoView());
      return true;
    },
  },
}));
