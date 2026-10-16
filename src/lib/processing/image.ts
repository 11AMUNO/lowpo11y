/**
 * Canvas-independent RGBA image buffer. Layout matches the DOM ImageData
 * (row-major, 4 bytes per pixel, straight/non-premultiplied alpha) so buffers
 * move between workers, canvases and Node without conversion.
 */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type RGBA = [number, number, number, number];
export type RGB = [number, number, number];

export const MAX_PIXELS = 4096 * 4096;

export function assertDimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError(`Invalid image size ${width}×${height}`);
  }
  if (width * height > MAX_PIXELS) {
    throw new RangeError(`Image ${width}×${height} exceeds the ${MAX_PIXELS.toLocaleString("en-GB")} pixel limit`);
  }
}

export function createImage(width: number, height: number, fill: RGBA = [0, 0, 0, 0]): RGBAImage {
  assertDimensions(width, height);
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill[0] || fill[1] || fill[2] || fill[3]) {
    for (let i = 0; i < data.length; i += 4) {
      data[i] = fill[0];
      data[i + 1] = fill[1];
      data[i + 2] = fill[2];
      data[i + 3] = fill[3];
    }
  }
  return { width, height, data };
}

export function cloneImage(img: RGBAImage): RGBAImage {
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}

export function getPixel(img: RGBAImage, x: number, y: number): RGBA {
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

export function setPixel(img: RGBAImage, x: number, y: number, c: RGBA | RGB): void {
  const i = (y * img.width + x) * 4;
  img.data[i] = c[0];
  img.data[i + 1] = c[1];
  img.data[i + 2] = c[2];
  img.data[i + 3] = c.length === 4 ? c[3] : 255;
}

/** True when any pixel has alpha below 255. */
export function hasTransparency(img: RGBAImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! < 255) return true;
  return false;
}

export function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 0 && (n & (n - 1)) === 0;
}

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function hexToRgb(hex: string): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`Invalid hex colour: ${hex}`);
  const v = parseInt(m[1]!, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]: RGB | RGBA): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}
