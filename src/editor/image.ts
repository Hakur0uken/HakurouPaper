import { imageSchema } from "@milkdown/preset-commonmark";
import { $prose, $view } from "@milkdown/utils";
import { Plugin, Selection } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { AssetV1 } from "../core/schema";
import type { AssetService } from "../platform";

export type ImageAssetPluginOptions = {
  documentPath: string | null;
  assetFolder: string | null;
  /**
   * The editor itself can remain mounted while a new save assigns a path.
   * Resolve these at interaction time so that save state does not require
   * rebuilding Milkdown and its node views.
   */
  getDocumentPath?: () => string | null;
  getAssetFolder?: () => string | null;
  assets: AssetService;
  findAsset: (displayPath: string) => AssetV1 | undefined;
  onAssetImported: (asset: AssetV1, assetFolder: string) => void;
  onAssetResize: (assetId: string, width: number) => void;
  onImportError: (error: unknown) => void;
};

type ResizeCorner = "northwest" | "northeast" | "southwest" | "southeast";

type ImageNodeViewOptions = Pick<ImageAssetPluginOptions, "assets" | "documentPath" | "getDocumentPath" | "findAsset" | "onAssetResize">;

class ImageNodeView {
  dom: HTMLElement;
  private readonly image: HTMLImageElement;
  private readonly options: ImageNodeViewOptions;
  private node: ProseNode;
  private removeResizeListeners: (() => void) | null = null;

  constructor(node: ProseNode, options: ImageNodeViewOptions) {
    this.node = node;
    this.options = options;
    this.dom = document.createElement("span");
    this.dom.className = "hakurou-image-frame";
    this.dom.contentEditable = "false";
    this.image = document.createElement("img");
    this.image.draggable = true;
    this.dom.append(this.image);
    (["northwest", "northeast", "southwest", "southeast"] as ResizeCorner[]).forEach((corner) => {
      const handle = document.createElement("span");
      handle.className = `hakurou-image-resize-handle is-${corner}`;
      handle.dataset.corner = corner;
      handle.addEventListener("pointerdown", (event) => this.startResize(event, corner));
      this.dom.append(handle);
    });
    this.updateImage(node);
  }

  update(node: ProseNode) {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.updateImage(node);
    return true;
  }

  selectNode() {
    this.dom.classList.add("is-selected");
  }

  deselectNode() {
    this.dom.classList.remove("is-selected");
  }

  stopEvent(event: Event) {
    return event.target instanceof Element && Boolean(event.target.closest(".hakurou-image-resize-handle"));
  }

  ignoreMutation() {
    return true;
  }

  destroy() {
    this.removeResizeListeners?.();
  }

  private updateImage(node: ProseNode) {
    const source = String(node.attrs.src ?? "");
    const asset = this.options.findAsset(source);
    this.image.src = this.options.assets.displaySource(source, this.options.getDocumentPath?.() ?? this.options.documentPath);
    this.image.alt = String(node.attrs.alt ?? "");
    this.image.title = String(node.attrs.title ?? node.attrs.alt ?? "");
    if (asset?.display?.width) {
      this.image.style.width = `${asset.display.width}px`;
      this.image.style.height = "auto";
    } else {
      this.image.style.removeProperty("width");
      this.image.style.removeProperty("height");
    }
  }

  private startResize(event: PointerEvent, corner: ResizeCorner) {
    const source = String(this.node.attrs.src ?? "");
    const asset = this.options.findAsset(source);
    if (!asset) return;
    event.preventDefault();
    event.stopPropagation();
    this.removeResizeListeners?.();
    const rect = this.image.getBoundingClientRect();
    const initialWidth = this.image.offsetWidth || rect.width;
    const initialHeight = this.image.offsetHeight || rect.height;
    if (initialWidth <= 0 || initialHeight <= 0) return;
    const screenScale = rect.width / initialWidth || 1;
    const aspectRatio = initialWidth / initialHeight;
    const startX = event.clientX;
    const startY = event.clientY;
    const horizontalDirection = corner.includes("west") ? -1 : 1;
    const verticalDirection = corner.includes("north") ? -1 : 1;
    let nextWidth = initialWidth;

    const onPointerMove = (moveEvent: PointerEvent) => {
      const horizontal = ((moveEvent.clientX - startX) * horizontalDirection) / screenScale;
      const vertical = ((moveEvent.clientY - startY) * verticalDirection * aspectRatio) / screenScale;
      const delta = Math.abs(horizontal) >= Math.abs(vertical) ? horizontal : vertical;
      nextWidth = Math.round(Math.min(5000, Math.max(80, initialWidth + delta)));
      this.image.style.width = `${nextWidth}px`;
      this.image.style.height = "auto";
    };
    const finishResize = (persist: boolean) => {
      this.removeResizeListeners?.();
      this.removeResizeListeners = null;
      if (persist && nextWidth !== initialWidth) this.options.onAssetResize(asset.assetId, nextWidth);
    };
    const onPointerUp = () => finishResize(true);
    const onPointerCancel = () => finishResize(false);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    window.addEventListener("pointercancel", onPointerCancel, { once: true });
    this.removeResizeListeners = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }
}

const imageCursorNavigation = $prose(() => new Plugin({
  props: {
    handleKeyDown(view, event) {
      if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return false;
      const { state } = view;
      if (!state.selection.empty) return false;
      const { $from } = state.selection;
      const movingLeft = event.key === "ArrowLeft";
      const neighbor = movingLeft ? $from.nodeBefore : $from.nodeAfter;
      if (neighbor?.type.name !== "image") return false;
      const target = movingLeft ? $from.pos - neighbor.nodeSize : $from.pos + neighbor.nodeSize;
      event.preventDefault();
      view.dispatch(state.tr.setSelection(Selection.near(state.doc.resolve(target), movingLeft ? -1 : 1)));
      return true;
    },
  },
}));

export function createImageAssetPlugins({ documentPath, assetFolder, getDocumentPath, getAssetFolder, assets, findAsset, onAssetImported, onAssetResize, onImportError }: ImageAssetPluginOptions) {
  const localImageView = $view(imageSchema.node, () => (node) => new ImageNodeView(node, {
    assets,
    documentPath,
    getDocumentPath,
    findAsset,
    onAssetResize,
  }));

  const localImagePaste = $prose((ctx) => new Plugin({
    props: {
      handlePaste(view, event) {
        const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
        if (!image) return false;
        event.preventDefault();
        const currentDocumentPath = getDocumentPath?.() ?? documentPath;
        if (!currentDocumentPath) {
          onImportError("请先保存文稿，再粘贴图片。保存后图片会自动放入同级 assets 文件夹。");
          return true;
        }
        void (async () => {
          try {
            const imported = await assets.importClipboardAsset({ documentPath: currentDocumentPath, assetFolder: getAssetFolder?.() ?? assetFolder, file: image });
            onAssetImported(imported.asset, imported.assetFolder);
            const imageNode = imageSchema.type(ctx).create({ src: imported.displayPath, alt: "", title: "" });
            view.dispatch(view.state.tr.replaceSelectionWith(imageNode));
          } catch (error) {
            onImportError(`无法粘贴图片：${String(error)}`);
          }
        })();
        return true;
      },
    },
  }));

  return [localImageView, localImagePaste, imageCursorNavigation];
}
