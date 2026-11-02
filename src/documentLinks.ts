import type { MouseEvent } from "react";
import { platform } from "./platform";

function externalUrl(href: string): string | null {
  try {
    // Protocol-relative web links must not inherit the desktop WebView's scheme.
    const url = new URL(href.startsWith("//") ? `https:${href}` : href);
    return ["http:", "https:", "mailto:", "tel:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

/** Route document links through the OS instead of navigating the editor WebView. */
export function handleDocumentLinkClick(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0 && event.button !== 1) return;
  const target = event.target instanceof Element ? event.target : null;
  const anchor = target?.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || !event.currentTarget.contains(anchor)) return;

  const href = anchor.getAttribute("href")?.trim() ?? "";
  // Leave document-local anchors to the renderer's existing navigation.
  if (href.startsWith("#")) return;
  event.preventDefault();
  event.stopPropagation();

  // A click may be emitted after dragging across link text. Keep that selection.
  const selection = event.currentTarget.ownerDocument.getSelection();
  if (selection && !selection.isCollapsed && event.currentTarget.contains(selection.anchorNode)) return;
  const url = externalUrl(href);
  if (!url) return;
  void platform.links.openExternal(url).catch((error) => window.alert(String(error)));
}
