/**
 * Server-side preview generation (Node): thumbnails for images and models,
 * texture size variants. Derivatives are small WebP/PNG files so catalogue
 * pages never load originals.
 */
import sharp from "sharp";
import { parseGlb } from "@/lib/formats/gltf";
import { extractMeshes, imageBytes } from "@/lib/formats/gltf-meshes";
import type { RGBAImage } from "@/lib/processing/image";
import { renderMeshes, type RenderOptions, type RenderTexture } from "@/lib/render/rasterizer";

export const THUMB_SIZE = 512;

export function toRaw(img: RGBAImage) {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  });
}

export async function decodeRgba(bytes: Uint8Array, maxSide = 2048): Promise<RGBAImage> {
  const { data, info } = await sharp(bytes, { limitInputPixels: 8192 * 8192 })
    .resize({ width: maxSide, height: maxSide, fit: "inside", withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

/** Renders a GLB to an RGBA image with the software rasterizer. */
export async function renderGlb(glb: Uint8Array, opts: Partial<RenderOptions> = {}): Promise<RGBAImage> {
  const doc = parseGlb(glb);
  const meshes = extractMeshes(doc);
  const textures = new Map<number, RenderTexture>();
  for (const m of meshes) {
    if (m.imageIndex === null || textures.has(m.imageIndex)) continue;
    const bytes = imageBytes(doc, m.imageIndex);
    if (!bytes) continue;
    try {
      textures.set(m.imageIndex, { image: await decodeRgba(bytes, 1024), nearest: m.nearest });
    } catch {
      // Undecodable texture: render the material colour instead.
    }
  }
  return renderMeshes(meshes, textures, { width: THUMB_SIZE, height: THUMB_SIZE, supersample: 2, ...opts });
}

/** WebP thumbnail of a model on a transparent background. */
export async function modelThumbnail(glb: Uint8Array, size = THUMB_SIZE): Promise<Uint8Array> {
  const img = await renderGlb(glb, { width: size, height: size });
  return new Uint8Array(await toRaw(img).webp({ quality: 88, alphaQuality: 90 }).toBuffer());
}

/**
 * WebP thumbnail of an image. Small textures are upscaled with nearest
 * neighbour so pixel art stays crisp; large images are downscaled smoothly.
 */
export async function imageThumbnail(bytes: Uint8Array, size = THUMB_SIZE): Promise<Uint8Array> {
  const meta = await sharp(bytes).metadata();
  const longest = Math.max(meta.width ?? size, meta.height ?? size);
  const kernel = longest < size ? "nearest" : "lanczos3";
  const out = await sharp(bytes, { limitInputPixels: 8192 * 8192 })
    .resize({ width: size, height: size, fit: "inside", kernel, withoutEnlargement: false })
    .webp({ quality: 88, alphaQuality: 90, nearLossless: longest < size })
    .toBuffer();
  return new Uint8Array(out);
}

/** Power-of-two texture variants (nearest-neighbour), never larger than the source. */
export async function textureVariants(bytes: Uint8Array, sizes: number[] = [32, 64, 128, 256]): Promise<{ size: number; png: Uint8Array }[]> {
  const meta = await sharp(bytes).metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  const out: { size: number; png: Uint8Array }[] = [];
  for (const s of sizes) {
    if (s >= longest) continue;
    const png = await sharp(bytes).resize({ width: s, height: s, fit: "inside", kernel: "nearest" }).png({ compressionLevel: 9 }).toBuffer();
    out.push({ size: s, png: new Uint8Array(png) });
  }
  return out;
}
