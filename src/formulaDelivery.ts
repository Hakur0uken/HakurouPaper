import { renderKaTeXMathml, renderKaTeXPreviewPng } from "./formulaPreview";

export type FormulaPreviewAsset = {
  dataBase64: string;
  widthPx: number;
  heightPx: number;
  mathml: string;
  display: boolean;
  latex: string;
};

type MarkdownFormula = {
  latex: string;
  displayMode: boolean;
};

/**
 * Finds the Markdown math syntax supported by Hakurou's editor while ignoring
 * fenced and inline code. The output order intentionally matches Pandoc's Math
 * traversal order, which lets the export filter pair every formula with its
 * generated KaTeX preview by index.
 */
export function collectMarkdownFormulas(markdown: string): MarkdownFormula[] {
  const formulas: MarkdownFormula[] = [];
  let cursor = 0;
  let fence: "`" | "~" | null = null;
  let lineStart = true;

  while (cursor < markdown.length) {
    const imageEnd = markdownImageEnd(markdown, cursor);
    if (imageEnd !== null) {
      cursor = imageEnd;
      lineStart = false;
      continue;
    }
    if (lineStart && (markdown.startsWith("```", cursor) || markdown.startsWith("~~~", cursor))) {
      const marker = markdown[cursor] as "`" | "~";
      fence = fence === marker ? null : fence ?? marker;
      cursor += 3;
      lineStart = false;
      continue;
    }
    if (fence) {
      lineStart = markdown[cursor] === "\n";
      cursor += 1;
      continue;
    }
    if (markdown[cursor] === "`") {
      const ticks = consecutive(markdown, cursor, "`");
      const closing = markdown.indexOf("`".repeat(ticks), cursor + ticks);
      cursor = closing < 0 ? cursor + ticks : closing + ticks;
      lineStart = false;
      continue;
    }
    if (markdown[cursor] !== "$" || isEscaped(markdown, cursor)) {
      lineStart = markdown[cursor] === "\n";
      cursor += 1;
      continue;
    }

    const delimiterLength = markdown[cursor + 1] === "$" ? 2 : 1;
    // Match Pandoc's inline-math boundary rules closely enough that ordinary
    // prose such as "$ text $" is not rendered as a formula preview.
    if (delimiterLength === 1 && isWhitespace(markdown[cursor + delimiterLength])) {
      cursor += delimiterLength;
      lineStart = false;
      continue;
    }
    const closing = findMathClosingDelimiter(markdown, cursor + delimiterLength, delimiterLength);
    if (closing < 0) {
      cursor += delimiterLength;
      lineStart = false;
      continue;
    }
    const latex = markdown.slice(cursor + delimiterLength, closing);
    if (latex.trim()) formulas.push({ latex, displayMode: delimiterLength === 2 });
    cursor = closing + delimiterLength;
    lineStart = false;
  }
  return formulas;
}

export async function createKaTeXFormulaPreviews(markdown: string): Promise<FormulaPreviewAsset[]> {
  const formulas = collectMarkdownFormulas(markdown);
  const previews: FormulaPreviewAsset[] = [];
  for (const formula of formulas) {
    const previewLatex = formula.displayMode
      ? stripTrailingEquationTag(formula.latex)
      : formula.latex;
    const preview = await renderKaTeXPreviewPng(previewLatex, {
      displayMode: formula.displayMode,
      // 16 CSS px maps to 12pt in Word when the PNG width is explicitly set.
      fontSizePx: 16,
      paddingPx: formula.displayMode ? 5 : 3,
      pixelRatio: 2,
    });
    previews.push({
      dataBase64: dataUrlToBase64(preview.dataUrl),
      widthPx: Math.max(1, Math.round(preview.width)),
      heightPx: Math.max(1, Math.round(preview.height)),
      mathml: preview.mathml,
      display: formula.displayMode,
      // 原始 LaTeX（去掉 \tag）交给 MathType 官方引擎渲染显示层 WMF（KaTeX 预览仅作占位）。
      latex: previewLatex,
    });
  }
  return previews;
}

/**
 * MathType owns the final Word presentation.  Unlike the legacy KaTeX-preview
 * export, this path only needs presentation MathML, not an intermediate PNG.
 */
export function createMathTypeFormulaPayloads(markdown: string): FormulaPreviewAsset[] {
  return collectMarkdownFormulas(markdown).map((formula) => {
    const latex = formula.displayMode
      ? stripTrailingEquationTag(formula.latex)
      : formula.latex;
    return {
      // Kept for the shared IPC shape. MathType mode never reads this value.
      dataBase64: "",
      widthPx: 0,
      heightPx: 0,
      mathml: renderKaTeXMathml(latex, { displayMode: formula.displayMode }),
      display: formula.displayMode,
      latex,
    };
  });
}

function consecutive(value: string, start: number, character: string) {
  let length = 0;
  while (value[start + length] === character) length += 1;
  return length;
}

function isEscaped(value: string, index: number) {
  let slashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === "\\"; cursor -= 1) slashes += 1;
  return slashes % 2 === 1;
}

function markdownImageEnd(value: string, start: number) {
  if (!value.startsWith("![", start)) return null;
  const altEnd = value.indexOf("]", start + 2);
  if (altEnd < 0 || value[altEnd + 1] !== "(") return null;
  let depth = 0;
  for (let cursor = altEnd + 1; cursor < value.length; cursor += 1) {
    if (isEscaped(value, cursor)) continue;
    if (value[cursor] === "(") depth += 1;
    if (value[cursor] === ")") {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
  }
  return null;
}

function findMathClosingDelimiter(value: string, start: number, length: number) {
  for (let cursor = start; cursor < value.length; cursor += 1) {
    if (length === 1 && value[cursor] === "\n") return -1;
    if (value[cursor] !== "$" || isEscaped(value, cursor)) continue;
    if (length === 2) {
      if (value[cursor + 1] === "$") return cursor;
      continue;
    }
    if (
      value[cursor + 1] !== "$"
      && !isWhitespace(value[cursor - 1])
      && !isDigit(value[cursor + 1])
    ) return cursor;
  }
  return -1;
}

function isWhitespace(value: string | undefined) {
  return value === undefined || /\s/.test(value);
}

function isDigit(value: string | undefined) {
  return value !== undefined && value >= "0" && value <= "9";
}

/**
 * Equation tags are Word layout metadata, not part of the visual expression.
 * Keep the original TeX for later MathType conversion, but omit a trailing
 * \tag or \tag* from this validation-only KaTeX raster preview.
 */
function stripTrailingEquationTag(latex: string) {
  let end = latex.length;
  while (end > 0 && /\s/.test(latex[end - 1])) end -= 1;
  if (latex[end - 1] !== "}") return latex;

  let depth = 0;
  for (let cursor = end - 1; cursor >= 0; cursor -= 1) {
    if (latex[cursor] === "}") depth += 1;
    else if (latex[cursor] === "{") {
      depth -= 1;
      if (depth !== 0) continue;
      const before = latex.slice(0, cursor);
      const tag = before.endsWith("\\tag") || before.endsWith("\\tag*");
      return tag ? latex.slice(0, cursor - (before.endsWith("\\tag*") ? 5 : 4)).trimEnd() : latex;
    }
  }
  return latex;
}

function dataUrlToBase64(dataUrl: string) {
  const prefix = "data:image/png;base64,";
  if (!dataUrl.startsWith(prefix)) throw new Error("KaTeX 公式预览不是 PNG 数据。");
  return dataUrl.slice(prefix.length);
}
