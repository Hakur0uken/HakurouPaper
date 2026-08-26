export const HAKUROU_SCHEMA_VERSION = 1 as const;

export type AssetResourceV1 = {
  format: string;
  path: string;
  mimeType?: string;
};

export type AssetV1 = {
  schemaVersion: typeof HAKUROU_SCHEMA_VERSION;
  assetId: string;
  kind: "image";
  source: AssetResourceV1;
  preview?: AssetResourceV1;
};

export type DocumentV1 = {
  schemaVersion: typeof HAKUROU_SCHEMA_VERSION;
  documentId: string;
  kind: "markdown";
};

export type ProjectV1 = {
  schemaVersion: typeof HAKUROU_SCHEMA_VERSION;
  projectId: string;
  documentIds: string[];
};

export type DocumentSidecarV1 = {
  schemaVersion: typeof HAKUROU_SCHEMA_VERSION;
  document: DocumentV1;
  assets: AssetV1[];
  format: unknown;
};

export type ParsedDocumentSidecar = {
  sidecar: DocumentSidecarV1;
  source: "v1" | "legacy" | "empty";
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `hakurou-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function normalizeAssetPath(value: unknown) {
  if (typeof value !== "string") return null;
  const path = value.trim().replace(/\\/g, "/");
  if (!path.startsWith("./assets/") || path.includes("/../") || path.length > 420) return null;
  return path;
}

function formatFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  return extension || "binary";
}

function parseResource(value: unknown): AssetResourceV1 | null {
  if (!isRecord(value)) return null;
  const path = normalizeAssetPath(value.path);
  if (!path || typeof value.format !== "string" || !value.format.trim()) return null;
  const mimeType = typeof value.mimeType === "string" && value.mimeType.trim() ? value.mimeType.trim().slice(0, 120) : undefined;
  return { format: value.format.trim().toLowerCase().slice(0, 32), path, ...(mimeType ? { mimeType } : {}) };
}

function parseAsset(value: unknown): AssetV1 | null {
  if (!isRecord(value) || value.schemaVersion !== HAKUROU_SCHEMA_VERSION || value.kind !== "image" || typeof value.assetId !== "string" || !value.assetId.trim()) return null;
  const source = parseResource(value.source);
  if (!source) return null;
  const preview = value.preview === undefined ? undefined : parseResource(value.preview);
  if (value.preview !== undefined && !preview) return null;
  return {
    schemaVersion: HAKUROU_SCHEMA_VERSION,
    assetId: value.assetId.trim(),
    kind: "image",
    source,
    ...(preview ? { preview } : {}),
  };
}

function parseDocument(value: unknown): DocumentV1 | null {
  if (!isRecord(value) || value.schemaVersion !== HAKUROU_SCHEMA_VERSION || value.kind !== "markdown" || typeof value.documentId !== "string" || !value.documentId.trim()) return null;
  return { schemaVersion: HAKUROU_SCHEMA_VERSION, documentId: value.documentId.trim(), kind: "markdown" };
}

function legacyAssetsFromFormat(value: unknown): AssetV1[] {
  if (!isRecord(value) || !Array.isArray(value.images)) return [];
  return value.images.flatMap((entry) => {
    if (!isRecord(entry) || entry.originalFormat !== "emf") return [];
    const sourcePath = normalizeAssetPath(entry.originalPath);
    const previewPath = normalizeAssetPath(entry.previewPath);
    if (!sourcePath || !previewPath) return [];
    return [{
      schemaVersion: HAKUROU_SCHEMA_VERSION,
      assetId: createId(),
      kind: "image" as const,
      source: { format: "emf", path: sourcePath },
      preview: { format: formatFromPath(previewPath), path: previewPath },
    }];
  });
}

function withoutLegacyAssetMappings(value: unknown): unknown {
  if (!isRecord(value)) return {};
  const { images: _images, ...format } = value;
  return format;
}

export function createDocumentSchema(): DocumentV1 {
  return { schemaVersion: HAKUROU_SCHEMA_VERSION, documentId: createId(), kind: "markdown" };
}

export function createProjectSchema(documentIds: string[] = []): ProjectV1 {
  return { schemaVersion: HAKUROU_SCHEMA_VERSION, projectId: createId(), documentIds: [...documentIds] };
}

export function createImageAsset(source: AssetResourceV1, preview?: AssetResourceV1): AssetV1 {
  return {
    schemaVersion: HAKUROU_SCHEMA_VERSION,
    assetId: createId(),
    kind: "image",
    source,
    ...(preview ? { preview } : {}),
  };
}

export function collectDocumentImageAssets(markdown: string, assets: AssetV1[]) {
  const knownPaths = new Set(assets.flatMap((asset) => [asset.source.path, asset.preview?.path]));
  const discovered = [...assets];
  const pattern = /!\[[^\]]*\]\((\.\/assets\/[^\s)]+)(?:\s+[^)]*)?\)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(markdown)) !== null) {
    const path = normalizeAssetPath(match[1]);
    if (!path || knownPaths.has(path)) continue;
    const resource = { format: formatFromPath(path), path };
    discovered.push(createImageAsset(resource, resource));
    knownPaths.add(path);
  }
  return discovered;
}

export function parseDocumentSidecar(content: string | null | undefined): ParsedDocumentSidecar {
  if (!content?.trim()) {
    return {
      source: "empty",
      sidecar: { schemaVersion: HAKUROU_SCHEMA_VERSION, document: createDocumentSchema(), assets: [], format: {} },
    };
  }
  let value: unknown;
  try {
    value = JSON.parse(content) as unknown;
  } catch {
    return {
      source: "legacy",
      sidecar: { schemaVersion: HAKUROU_SCHEMA_VERSION, document: createDocumentSchema(), assets: [], format: {} },
    };
  }
  if (isRecord(value) && "schemaVersion" in value && value.schemaVersion !== HAKUROU_SCHEMA_VERSION) {
    throw new Error(`不支持的 HakurouPaper sidecar schemaVersion：${String(value.schemaVersion)}`);
  }
  if (isRecord(value) && value.schemaVersion === HAKUROU_SCHEMA_VERSION) {
    const document = parseDocument(value.document);
    const assets = Array.isArray(value.assets) ? value.assets.flatMap((asset) => {
      const parsed = parseAsset(asset);
      return parsed ? [parsed] : [];
    }) : [];
    if (!document) throw new Error("HakurouPaper sidecar v1 格式无效。");
    return {
      source: "v1",
      sidecar: { schemaVersion: HAKUROU_SCHEMA_VERSION, document, assets, format: value.format ?? {} },
    };
  }
  return {
    source: "legacy",
    sidecar: {
      schemaVersion: HAKUROU_SCHEMA_VERSION,
      document: createDocumentSchema(),
      assets: legacyAssetsFromFormat(value),
      format: withoutLegacyAssetMappings(value),
    },
  };
}

export function serializeDocumentSidecar(sidecar: DocumentSidecarV1) {
  return JSON.stringify(sidecar, null, 2);
}
