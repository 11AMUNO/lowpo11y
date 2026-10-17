"use client";

import type { RGBAImage } from "@/lib/processing/image";

/** Saves a blob through a temporary link (the browser shows its normal download UI). */
export function saveBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Decodes an image file to straight-alpha RGBA (worker or main thread). Throws on oversize. */
export async function decodeToRgba(file: Blob, maxPixels = 4096 * 4096): Promise<RGBAImage> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  } catch {
    throw new Error("This file can't be read as an image. It may be damaged or in a format this browser doesn't support; try PNG, JPG or WEBP.");
  }
  try {
    if (bmp.width * bmp.height > maxPixels) throw new Error(`This image is ${bmp.width}×${bmp.height}; the limit is ${Math.sqrt(maxPixels)}×${Math.sqrt(maxPixels)} pixels.`);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext("2d", { willReadFrequently: true })!;
    x.drawImage(bmp, 0, 0);
    const d = x.getImageData(0, 0, bmp.width, bmp.height);
    return { width: d.width, height: d.height, data: d.data };
  } finally {
    bmp.close();
  }
}

/** ImageBitmap for on-screen preview of an RGBA buffer. */
export function toBitmap(img: RGBAImage): Promise<ImageBitmap> {
  return createImageBitmap(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height));
}

export const baseName = (name: string) => name.replace(/\.[^.]+$/, "");
