/**
 * Maps an image onto a palette, or onto a per-channel bit-depth grid, with
 * optional ordered (Bayer), blue-noise or Floyd–Steinberg dithering. Shared
 * by the retro converter and the palette tool. Works in place on visible
 * pixels (alpha > 0); fully transparent pixels are left alone.
 */
import { blueNoise } from "./blue-noise";
import { bayerMatrix } from "./dither";
import type { RGB, RGBAImage } from "./image";
import { paletteMatcher, quantizeChannel, type BitDepth } from "./quantize";

export type DitherMode = "none" | "bayer2" | "bayer4" | "bayer8" | "blue" | "fs";

export interface RemapOptions {
  /** Target colours. Empty: snap to the `bits` grid instead. */
  palette: RGB[];
  bits?: BitDepth;
  dither: DitherMode;
  /** 0..1 */
  strength: number;
  /** Floyd–Steinberg errors wrap left↔right so tileable textures stay tileable. */
  wrap?: boolean;
}

function thresholds(mode: DitherMode): { m: Float32Array | number[]; n: number } | null {
  if (mode === "bayer2" || mode === "bayer4" || mode === "bayer8") {
    const n = mode === "bayer2" ? 2 : mode === "bayer4" ? 4 : 8;
    return { m: bayerMatrix(n).flat(), n };
  }
  if (mode === "blue") return { m: blueNoise(64), n: 64 };
  return null;
}

export function remapImage(img: RGBAImage, o: RemapOptions): void {
  const { width: w, height: h, data: d } = img;
  const bits = o.bits ?? { r: 8, g: 8, b: 8 };
  const snap = (c: RGB): RGB => [quantizeChannel(c[0], bits.r), quantizeChannel(c[1], bits.g), quantizeChannel(c[2], bits.b)];
  const match = o.palette.length ? paletteMatcher(o.palette) : null;
  const target = (r: number, g: number, b: number): RGB => (match ? match(r, g, b) : snap([r, g, b]));
  const strength = o.strength;
  const mode = strength > 0 ? o.dither : "none";
  // one quantisation step: how far apart neighbouring output colours roughly are
  const minBits = Math.min(bits.r, bits.g, bits.b);
  const spread = (match ? 255 / Math.max(1, Math.cbrt(o.palette.length) - 0.5) : 255 / ((1 << minBits) - 1)) * strength;
  if (mode === "fs") {
    const buf = new Float32Array(w * h * 3);
    for (let i = 0, j = 0; i < d.length; i += 4, j += 3) {
      buf[j] = d[i]!;
      buf[j + 1] = d[i + 1]!;
      buf[j + 2] = d[i + 2]!;
    }
    const push = (x: number, y: number, e: RGB, f: number) => {
      if (y >= h) return;
      if (!o.wrap && (x < 0 || x >= w)) return;
      const xx = (x + w) % w;
      const j = (y * w + xx) * 3;
      if (d[(y * w + xx) * 4 + 3] === 0) return; // don't push error into transparent pixels
      buf[j]! += e[0] * f;
      buf[j + 1]! += e[1] * f;
      buf[j + 2]! += e[2] * f;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] === 0) continue;
        const j = (y * w + x) * 3;
        const r = buf[j]!,
          g = buf[j + 1]!,
          b = buf[j + 2]!;
        const c = target(Math.round(r), Math.round(g), Math.round(b));
        d[i] = c[0];
        d[i + 1] = c[1];
        d[i + 2] = c[2];
        const e: RGB = [(r - c[0]) * strength, (g - c[1]) * strength, (b - c[2]) * strength];
        push(x + 1, y, e, 7 / 16);
        push(x - 1, y + 1, e, 3 / 16);
        push(x, y + 1, e, 5 / 16);
        push(x + 1, y + 1, e, 1 / 16);
      }
    return;
  }
  const t = thresholds(mode);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const off = t ? (Number(t.m[(y % t.n) * t.n + (x % t.n)]) - 0.5) * spread : 0;
      const c = target(Math.round(d[i]! + off), Math.round(d[i + 1]! + off), Math.round(d[i + 2]! + off));
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
    }
}
