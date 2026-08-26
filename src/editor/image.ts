import { imageSchema } from "@milkdown/preset-commonmark";
import { $prose, $view } from "@milkdown/utils";
import { Plugin, Selection } from "@milkdown/prose/state";
import type { Node as ProseNode } from "@milkdown/prose/model";
import type { AssetV1 } from "../core/schema";
import type { AssetService } from "../platform";

export type ImageAssetPluginOptions = {
  documentPath: string | null;
  assetFolder: string | null;
  assets: AssetService;
  onAssetImported: (asset: AssetV1, assetFolder: string) => void;
  onImportError: (error: unknown) => void;
};

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

export function createImageAssetPlugins({ documentPath, assetFolder, assets, onAssetImported, onImportError }: ImageAssetPluginOptions) {
  const localImageView = $view(imageSchema.node, () => (node) => {
    const image = document.createElement("img");
    image.contentEditable = "false";
    image.draggable = true;
    const updateImage = (nextNode: ProseNode) => {
      image.src = assets.displaySource(String(nextNode.attrs.src ?? ""), documentPath);
      image.alt = String(nextNode.attrs.alt ?? "");
      image.title = String(nextNode.attrs.title ?? nextNode.attrs.alt ?? "");
    };
    updateImage(node);
    return {
      dom: image,
      update(nextNode: ProseNode) {
        if (nextNode.type !== node.type) return false;
        updateImage(nextNode);
        return true;
      },
    };
  });

  const localImagePaste = $prose((ctx) => new Plugin({
    props: {
      handlePaste(view, event) {
        const image = Array.from(event.clipboardData?.files ?? []).find((file) => file.type.startsWith("image/"));
        if (!image) return false;
        event.preventDefault();
        if (!documentPath) {
          onImportError("请先保存文稿，再粘贴图片。保存后图片会自动放入同级 assets 文件夹。");
          return true;
        }
        void (async () => {
          try {
            const imported = await assets.importClipboardAsset({ documentPath, assetFolder, file: image });
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
