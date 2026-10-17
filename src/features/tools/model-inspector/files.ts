/**
 * Picking the model out of a multi-file selection and resolving a .gltf's
 * external references (buffers, images) against the other selected files.
 * Pure, so it can be unit tested without a browser.
 */

export interface NamedFile {
  name: string;
  /** Folder-relative path when the files came from a folder picker. */
  path?: string;
}

const MODEL_RE = /\.(glb|gltf)$/i;

/** The model file in a selection: a .glb, otherwise a .gltf. Null when there's none. */
export function pickModel<T extends NamedFile>(files: T[]): T | null {
  return files.find((f) => /\.glb$/i.test(f.name)) ?? files.find((f) => /\.gltf$/i.test(f.name)) ?? null;
}

export const isModelFile = (name: string) => MODEL_RE.test(name);

const norm = (s: string) =>
  s
    .replace(/\\/g, "/")
    .replace(/^(\.\/)+/, "")
    .toLowerCase();

/**
 * Finds the selected file a URI refers to: by relative path first, then by
 * file name alone (folder structure is often lost when picking files).
 */
export function resolveUri<T extends NamedFile>(uri: string, files: T[]): T | null {
  if (/^(data|blob):/i.test(uri)) return null;
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    // keep the raw URI
  }
  const want = norm(decoded.split(/[?#]/)[0]!);
  const base = want.split("/").pop()!;
  return files.find((f) => f.path && norm(f.path).endsWith(want)) ?? files.find((f) => norm(f.name) === want) ?? files.find((f) => norm(f.name) === base) ?? null;
}

/** External URIs a glTF JSON references (buffers and images, not data: URIs). */
export function externalUris(json: { buffers?: { uri?: unknown }[]; images?: { uri?: unknown }[] }): string[] {
  const out: string[] = [];
  for (const b of json.buffers ?? []) if (typeof b.uri === "string" && !/^data:/i.test(b.uri)) out.push(b.uri);
  for (const i of json.images ?? []) if (typeof i.uri === "string" && !/^data:/i.test(i.uri)) out.push(i.uri);
  return out;
}

/** Extensions the inspector can't decode, with what to do about each. */
export const UNSUPPORTED_EXTENSION_HELP: Record<string, string> = {
  KHR_draco_mesh_compression: "Draco-compressed geometry. Export again without Draco compression to inspect it here.",
  EXT_meshopt_compression: "meshopt-compressed geometry. Export again without meshopt compression to inspect it here.",
  KHR_texture_basisu: "KTX2 / Basis Universal textures. Export again with PNG or JPG textures to inspect them here.",
  EXT_texture_avif: "AVIF textures, which this inspector doesn't decode.",
};
