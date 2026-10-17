/**
 * Hashing for the Workshop: stable JSON for parameters, a fast 64-bit
 * FNV-1a for cache keys, and SHA-256 (Web Crypto, in browsers, workers and
 * Node) for image contents and the manifest's checksums.
 */

/** JSON with object keys sorted, so equal settings always give the same text. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
    .join(",")}}`;
}

/** 64-bit FNV-1a of a string, as 16 hex digits. Not cryptographic; for cache keys only. */
export function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i++) {
    h ^= BigInt(text.charCodeAt(i));
    h = (h * prime) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

export async function sha256Hex(bytes: Uint8Array | Uint8ClampedArray | ArrayBuffer): Promise<string> {
  const view = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const digest = await crypto.subtle.digest("SHA-256", view as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Content key for an image: its size and the SHA-256 of its pixels. */
export async function imageKey(img: { width: number; height: number; data: Uint8ClampedArray }): Promise<string> {
  return `img:${img.width}x${img.height}:${await sha256Hex(img.data)}`;
}
