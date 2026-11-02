import { useEffect, useMemo, useRef, useState } from "react";
import type { EditorView } from "@milkdown/prose/view";
import { mapSourceLines, parseSourceBlocks } from "./sourceLineMapping";

type Marker = { start: number; end: number; top: number };

/** A display-only gutter: no decorations, document nodes or clipboard content. */
export function SourceLineNumbers({ view, markdown }: { view: EditorView | null; markdown: string }) {
  const gutterRef = useRef<HTMLDivElement>(null);
  const blocks = useMemo(() => parseSourceBlocks(markdown), [markdown]);
  const [layout, setLayout] = useState<{ left: number; markers: Marker[] }>({ left: 0, markers: [] });

  useEffect(() => {
    const root = gutterRef.current?.parentElement;
    const stage = root?.closest(".editor-stage");
    if (!view || !root || !stage) return;
    let frame = 0;
    let disposed = false;
    const measure = () => {
      frame = 0;
      if (disposed || view.isDestroyed) return;
      const origin = root.getBoundingClientRect();
      const editorRect = view.dom.getBoundingClientRect();
      const markers: Marker[] = [];
      for (const anchor of mapSourceLines(blocks, view.state.doc)) {
        const element = view.nodeDOM(anchor.position);
        if (!(element instanceof HTMLElement) || !element.getClientRects().length) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.height) continue;
        let top = rect.top + Math.min(rect.height / 2, 17);
        if (anchor.textblock) {
          const caret = view.coordsAtPos(anchor.position + 1);
          top = (caret.top + caret.bottom) / 2;
        } else if (anchor.kind === "row") {
          const cell = element.querySelector("p");
          if (cell) {
            const cellRect = cell.getBoundingClientRect();
            const lineHeight = parseFloat(getComputedStyle(cell).lineHeight) || 22;
            top = cellRect.top + Math.min(cellRect.height, lineHeight) / 2;
          }
        }
        markers.push({ start: anchor.start, end: anchor.end, top: top - origin.top });
      }
      setLayout({ left: editorRect.left - origin.left - 112, markers });
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(measure);
    };
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(view.dom);
    resizeObserver.observe(root);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(view.dom, { childList: true, subtree: true, characterData: true, attributes: true });
    // Document font controls and comparison visibility live on the outer stage.
    mutationObserver.observe(stage, { attributes: true });
    view.dom.addEventListener("load", schedule, true);
    window.addEventListener("resize", schedule);
    document.fonts.addEventListener("loadingdone", schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      view.dom.removeEventListener("load", schedule, true);
      window.removeEventListener("resize", schedule);
      document.fonts.removeEventListener("loadingdone", schedule);
    };
  }, [blocks, view]);

  return <div ref={gutterRef} className="source-line-numbers" aria-hidden="true" style={{ left: layout.left }}>
    {layout.markers.map((marker, index) => <span key={`${marker.start}:${index}`} style={{ top: marker.top }}>
      {marker.start === marker.end ? marker.start : `${marker.start}–${marker.end}`}
    </span>)}
  </div>;
}
