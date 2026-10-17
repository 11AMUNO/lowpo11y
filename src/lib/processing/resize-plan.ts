/** Output-size rules for the batch resizer (pure, shared by the worker, UI and tests). */
import { longSideSize, type Fit, type Sampling } from "./resample";

export interface ResizeSettings {
  mode: "long" | "exact" | "scale";
  width: number;
  height: number;
  /** percent, for mode "scale" */
  scale: number;
  /** Round each side to the nearest power of two. */
  pot: boolean;
  fit: Fit;
  sampling: Sampling;
  format: "keep" | "png" | "jpg" | "webp";
  quality: number;
}

export const RESIZE_DEFAULTS: ResizeSettings = { mode: "long", width: 256, height: 256, scale: 50, pot: false, fit: "crop", sampling: "nearest", format: "png", quality: 92 };

export const nearestPowerOfTwo = (n: number) => Math.max(1, 2 ** Math.round(Math.log2(Math.max(1, n))));

export function plannedSize(w: number, h: number, s: ResizeSettings): [number, number] {
  let out: [number, number] =
    s.mode === "long" ? longSideSize(w, h, s.width) : s.mode === "scale" ? [Math.max(1, Math.round((w * s.scale) / 100)), Math.max(1, Math.round((h * s.scale) / 100))] : [s.width, s.height];
  if (s.pot) out = [nearestPowerOfTwo(out[0]), nearestPowerOfTwo(out[1])];
  return [Math.min(8192, out[0]), Math.min(8192, out[1])];
}

/** With "long"/"scale" the aspect is kept, so stretching to the planned size is exact; "exact" uses the chosen fit. */
export const fitFor = (s: ResizeSettings): Fit => (s.mode === "exact" ? s.fit : "stretch");

export function outputFormat(s: ResizeSettings, inputType: string): "png" | "jpg" | "webp" {
  if (s.format !== "keep") return s.format;
  return inputType === "image/jpeg" ? "jpg" : inputType === "image/webp" ? "webp" : "png";
}
