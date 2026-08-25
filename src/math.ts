import katex from "katex";
import { nodeRule } from "@milkdown/prose";
import { $inputRule, $nodeSchema, $remark } from "@milkdown/utils";
import remarkMath from "remark-math";

export const mathInlineId = "hakurou_math_inline";

export const mathInlineSchema = $nodeSchema(mathInlineId, () => ({
  group: "inline",
  inline: true,
  atom: true,
  attrs: {
    value: { default: "" },
  },
  parseDOM: [{
    tag: `span[data-type="${mathInlineId}"]`,
    getAttrs: (dom) => ({ value: (dom as HTMLElement).dataset.value ?? "" }),
  }],
  toDOM: (node) => {
    const dom = document.createElement("span");
    dom.dataset.type = mathInlineId;
    dom.dataset.value = node.attrs.value;
    dom.className = "hakurou-math-inline";
    katex.render(node.attrs.value, dom, { throwOnError: false });
    return dom;
  },
  parseMarkdown: {
    match: (node) => node.type === "inlineMath",
    runner: (state, node, type) => state.addNode(type, { value: node.value }),
  },
  toMarkdown: {
    match: (node) => node.type.name === mathInlineId,
    runner: (state, node) => state.addNode("inlineMath", undefined, node.attrs.value),
  },
}));

export const remarkMathPlugin = $remark("hakurouRemarkMath", () => remarkMath);

export const mathInlineInputRule = $inputRule((ctx) => (
  nodeRule(/\$([^$\n]+)\$$/, mathInlineSchema.type(ctx), {
    getAttr: (match) => ({ value: match[1] ?? "" }),
  })
));
