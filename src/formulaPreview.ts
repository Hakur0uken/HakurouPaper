import katex from "katex";
import "katex/dist/katex.min.css";
import html2canvas from "html2canvas";

export type FormulaPreviewOptions = {
  displayMode: boolean;
  fontSizePx?: number;
  paddingPx?: number;
  pixelRatio?: number;
};

export type FormulaPreviewPng = {
  dataUrl: string;
  width: number;
  height: number;
  mathml: string;
};

/**
 * Produces the presentation MathML MathType needs without painting a canvas.
 *
 * A MathType DOCX export creates its own OLE/WMF presentation in Word, so the
 * browser PNG is neither embedded nor used for sizing.  Keeping this narrow
 * path separate means a large paper does not pay for one html2canvas render
 * per formula before the native export has even started.
 */
export function renderKaTeXMathml(
  latex: string,
  options: Pick<FormulaPreviewOptions, "displayMode">,
): string {
  const element = document.createElement("div");
  element.innerHTML = katex.renderToString(latex || "\\text{ }", {
    displayMode: options.displayMode,
    throwOnError: false,
    strict: "ignore",
  });
  const math = element.querySelector("math");
  if (!(math instanceof Element)) throw new Error("KaTeX 未生成可转换的 MathML。");
  const mathml = math.cloneNode(true) as Element;
  mathml.querySelectorAll("annotation").forEach((annotation) => annotation.remove());
  return mathml.outerHTML;
}

/**
 * Draws the same KaTeX HTML used by the editor into an in-memory PNG.
 *
 * This deliberately stays in the application WebView: no external browser,
 * Word, MathType, or command-line renderer is started. The PNG is intended as
 * the cached visual layer for a future MathType OLE object in a DOCX.
 */
export async function renderKaTeXPreviewPng(
  latex: string,
  options: FormulaPreviewOptions,
): Promise<FormulaPreviewPng> {
  const fontSizePx = options.fontSizePx ?? 20;
  const paddingPx = options.paddingPx ?? 4;
  const pixelRatio = Math.max(1, Math.min(options.pixelRatio ?? 2, 4));
  const captureId = `hakurou-formula-preview-${crypto.randomUUID()}`;
  const element = document.createElement("div");
  element.id = captureId;
  element.className = options.displayMode ? "hakurou-export-formula katex-display" : "hakurou-export-formula";
  element.style.cssText = [
    "position:fixed",
    "left:-10000px",
    "top:0",
    "display:inline-block",
    "width:max-content",
    "max-width:none",
    "margin:0",
    `padding:${paddingPx}px`,
    "visibility:hidden",
    `font-size:${fontSizePx}px`,
    "line-height:1",
  ].join(";");
  element.innerHTML = katex.renderToString(latex || "\\text{ }", {
    displayMode: options.displayMode,
    throwOnError: false,
    strict: "ignore",
  });
  document.body.append(element);

  try {
    await document.fonts?.ready;
    await nextAnimationFrame();
    const canvas = await html2canvas(element, {
      backgroundColor: null,
      logging: false,
      scale: pixelRatio,
      onclone: (clonedDocument) => {
        // Keep the source node invisible to the user, but make its clone
        // visible to the local capture engine.
        const clonedElement = clonedDocument.getElementById(captureId);
        if (clonedElement instanceof HTMLElement) {
          clonedElement.style.visibility = "visible";
          clonedElement.style.left = "0";
          clonedElement.style.top = "0";
        }
      },
    });
    return {
      dataUrl: canvas.toDataURL("image/png"),
      width: canvas.width / pixelRatio,
      height: canvas.height / pixelRatio,
      mathml: renderKaTeXMathml(latex, options),
    };
  } finally {
    element.remove();
  }
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
