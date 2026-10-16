import { StorageError } from "./types";

/**
 * Object keys are built only here, from server-generated ids — never from
 * user-supplied paths (docs/decisions/0004).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXT = /^[a-z0-9]{1,8}$/;
const SAFE_KEY = /^[a-z0-9][a-z0-9._/-]*$/;

function id(value: string, label: string) {
  if (!UUID.test(value)) throw new StorageError(`Invalid ${label} id`);
  return value;
}

function ext(value: string) {
  const e = value.toLowerCase().replace(/^\./, "");
  if (!EXT.test(e)) throw new StorageError("Invalid file extension");
  return e;
}

const PURPOSES = new Set(["source", "delivery", "thumbnail", "preview", "dependency", "bundle"]);
function purposeSeg(p: string) {
  if (!PURPOSES.has(p)) throw new StorageError("Invalid file purpose");
  return p;
}

export const keys = {
  staging: (uploadSessionId: string) => `staging/${id(uploadSessionId, "upload session")}/incoming`,
  assetFile: (assetId: string, purpose: string, fileId: string, extension: string) =>
    `assets/${id(assetId, "asset")}/${purposeSeg(purpose)}/${id(fileId, "file")}.${ext(extension)}`,
  assetDerivative: (assetId: string, fileId: string, variant: string, extension: string) =>
    `assets/${id(assetId, "asset")}/derived/${id(fileId, "file")}-${variant.replace(/[^a-z0-9-]/g, "")}.${ext(extension)}`,
  assetBundle: (assetId: string, version: number) => `assets/${id(assetId, "asset")}/bundle/v${version}.zip`,
  collectionBundle: (collectionId: string, version: string) => `collections/${id(collectionId, "collection")}/bundle-${version.replace(/[^a-z0-9-]/g, "")}.zip`,
  resourceFile: (kind: "shaders" | "starters", resourceId: string, fileId: string, extension: string) =>
    `${kind}/${id(resourceId, "resource")}/${id(fileId, "file")}.${ext(extension)}`,
};

/** Defence in depth for adapters: reject anything that could escape a bucket. */
export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//") || key.length > 512) {
    throw new StorageError("Unsafe storage key");
  }
}

/** Sanitise a filename for Content-Disposition and ZIP entries. */
export function safeFilename(name: string, fallback = "file"): string {
  const cleaned = name
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[._\s]+/, "")
    .trim()
    .slice(0, 180);
  return cleaned || fallback;
}

export function contentDisposition(name: string): string {
  const safe = safeFilename(name);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}
