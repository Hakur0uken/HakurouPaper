import { useLayoutEffect, useState } from "react";
import type { RevisionLocation } from "./revisionTypes";

type RulerLayout = { top: number; left: number; height: number; positions: Map<string, number> };

function sameLayout(left: RulerLayout | null, right: RulerLayout) {
  if (!left || left.top !== right.top || left.left !== right.left || left.height !== right.height || left.positions.size !== right.positions.size) return false;
  return [...right.positions].every(([id, position]) => left.positions.get(id) === position);
}

/**
 * A compact overview strip deliberately aligned to the native scrollbar.  Its
 * markers use rendered DOM positions where possible, so a click maps to the
 * same scroll range as the scrollbar thumb instead of a count of Markdown blocks.
 */
export function RevisionOverviewRuler({ locations, activeLocationId, onNavigate, scrollContainer, className = "" }: { locations: RevisionLocation[]; activeLocationId?: string | null; onNavigate: (location: RevisionLocation) => void; scrollContainer: HTMLElement | null; className?: string }) {
  const [layout, setLayout] = useState<RulerLayout | null>(null);

  useLayoutEffect(() => {
    if (!scrollContainer || locations.length === 0) {
      setLayout(null);
      return;
    }
    let frame = 0;
    const update = () => {
      const bounds = scrollContainer.getBoundingClientRect();
      const styles = window.getComputedStyle(scrollContainer);
      const borderLeft = Number.parseFloat(styles.borderLeftWidth) || 0;
      const borderRight = Number.parseFloat(styles.borderRightWidth) || 0;
      const borderTop = Number.parseFloat(styles.borderTopWidth) || 0;
      const borderBottom = Number.parseFloat(styles.borderBottomWidth) || 0;
      const measuredScrollbarWidth = scrollContainer.offsetWidth - scrollContainer.clientWidth - borderLeft - borderRight;
      const scrollbarWidth = measuredScrollbarWidth > 1 ? measuredScrollbarWidth : 12;
      const scrollRange = scrollContainer.scrollHeight - scrollContainer.clientHeight;
      const positions = new Map<string, number>();
      locations.forEach((location) => {
        const target = scrollContainer.querySelector<HTMLElement>(`[data-revision-location="${location.id}"]`);
        const targetTop = target
          ? scrollContainer.scrollTop + target.getBoundingClientRect().top - bounds.top
          : null;
        const position = targetTop !== null && scrollRange > 0
          ? targetTop / scrollRange
          : location.relativePosition;
        positions.set(location.id, Math.max(0, Math.min(1, position)));
      });
      const next = {
        top: bounds.top + borderTop,
        left: Math.max(bounds.left, bounds.right - borderRight - scrollbarWidth - 4),
        height: Math.max(0, bounds.height - borderTop - borderBottom),
        positions,
      } satisfies RulerLayout;
      setLayout((previous) => sameLayout(previous, next) ? previous : next);
    };
    const scheduleUpdate = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(update);
    };
    update();
    // A second frame catches images and editor decorations that settle just after React commits.
    scheduleUpdate();
    const resizeObserver = new ResizeObserver(scheduleUpdate);
    resizeObserver.observe(scrollContainer);
    scrollContainer.addEventListener("load", scheduleUpdate, true);
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      scrollContainer.removeEventListener("load", scheduleUpdate, true);
      window.removeEventListener("resize", scheduleUpdate);
    };
  }, [locations, scrollContainer]);

  if (locations.length === 0 || !layout) return null;
  const markers = [...locations]
    .map((location) => ({ location, position: layout.positions.get(location.id) ?? location.relativePosition }))
    .sort((left, right) => left.position - right.position);
  return <nav
    className={`revision-overview-ruler ${className}`.trim()}
    style={{ top: layout.top, left: layout.left, height: layout.height }}
    aria-label="全文修改概览"
  >
    {markers.map(({ location, position }, index) => {
      const next = markers[index + 1];
      const gap = next ? next.position - position : 1;
      const height = gap <= .012 ? Math.max(.22, gap * 100) : .65;
      return <button
      key={location.id}
      type="button"
      className={`is-${location.kind}${activeLocationId === location.id ? " is-active" : ""}`}
      style={{ top: `${position * 100}%`, height: `${height}%` }}
      onClick={() => onNavigate(location)}
      aria-label={`${location.kind === "added" ? "新增" : location.kind === "modified" ? "修改" : "删除"}：${location.headingPath[location.headingPath.length - 1] ?? "文稿位置"}`}
      title={location.headingPath.join(" › ") || "文稿修改"}
    />;
    })}
  </nav>;
}
