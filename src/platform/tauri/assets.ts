import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { createImageAsset, type AssetResourceV1 } from "../../core/schema";
import type { AssetService, ClipboardAssetInput, ImportedClipboardAsset } from "../types";

type SavedImage = {
  relativePath: string;
  assetFolder: string;
};

type SavedEmfImage = SavedImage & {
  originalRelativePath: string;
};

function fileToBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取图片。"));
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const separator = dataUrl.indexOf(",");
      resolve(separator >= 0 ? dataUrl.slice(separator + 1) : dataUrl);
    };
    reader.readAsDataURL(file);
  });
}

function formatFromMime(mimeType: string, fallbackPath: string) {
  const fromMime = mimeType.split("/")[1]?.toLowerCase();
  return fromMime || fallbackPath.split(".").pop()?.toLowerCase() || "binary";
}

function source(format: string, path: string, mimeType?: string): AssetResourceV1 {
  return { format, path, ...(mimeType ? { mimeType } : {}) };
}

export const tauriAssets: AssetService = {
  displaySource(relativeSource, documentPath) {
    if (!documentPath || /^(?:data:|https?:|asset:|blob:)/i.test(relativeSource)) return relativeSource;
    const documentFolder = documentPath.replace(/[\\/][^\\/]+$/, "");
    const sourcePath = relativeSource.replace(/^\.\//, "").replace(/\//g, "\\");
    return convertFileSrc(`${documentFolder}\\${sourcePath}`);
  },
  async importClipboardAsset({ documentPath, assetFolder, file }: ClipboardAssetInput): Promise<ImportedClipboardAsset> {
    const savedEmf = await invoke<SavedEmfImage | null>("save_clipboard_emf_preview", { documentPath, assetFolder });
    if (savedEmf) {
      return {
        assetFolder: savedEmf.assetFolder,
        displayPath: savedEmf.relativePath,
        asset: createImageAsset(source("emf", savedEmf.originalRelativePath), source("png", savedEmf.relativePath, "image/png")),
      };
    }
    const savedImage = await invoke<SavedImage>("save_pasted_image", {
      documentPath,
      dataBase64: await fileToBase64(file),
      mimeType: file.type,
      assetFolder,
    });
    const format = formatFromMime(file.type, savedImage.relativePath);
    const imageSource = source(format, savedImage.relativePath, file.type || undefined);
    return {
      assetFolder: savedImage.assetFolder,
      displayPath: savedImage.relativePath,
      asset: createImageAsset(imageSource, imageSource),
    };
  },
};
