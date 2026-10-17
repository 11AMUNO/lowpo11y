/**
 * Sample sources for the decal tool (CC0, generated): a warning sign shot on
 * a green screen, and a painted tag on black. Both have antialiased edges
 * that mix with the background, which is what edge cleanup has to undo.
 */
import { pixelFontGlyphs } from "./pixel-font";
import { createImage, type RGB, type RGBAImage } from "@/lib/processing/image";
import { hash2 } from "@/lib/processing/random";

export const SIGN_COLOURS = { screen: [31, 176, 74] as RGB, yellow: [246, 196, 34] as RGB, ink: [20, 18, 16] as RGB };
export const TAG_COLOURS = { paint: [242, 234, 216] as RGB, ground: [10, 10, 10] as RGB };

/** Supersampled 4×4 per pixel, plus a little sensor noise. */
function render(w: number, h: number, colourAt: (x: number, y: number) => RGB, noise: number, seed: number): RGBAImage {
  const img = createImage(w, h);
  const S = 4;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = 0; sy < S; sy++)
        for (let sx = 0; sx < S; sx++) {
          const c = colourAt(x + (sx + 0.5) / S, y + (sy + 0.5) / S);
          r += c[0];
          g += c[1];
          b += c[2];
        }
      const n = (hash2(x, y, seed) - 0.5) * noise;
      img.data.set([r / (S * S) + n, g / (S * S) + n, b / (S * S) + n, 255], (y * w + x) * 4);
    }
  return img;
}

export function greenScreenSign(size = 256): RGBAImage {
  const cx = size / 2,
    top = size * 0.12,
    bottom = size * 0.86,
    half = (bottom - top) / Math.sqrt(3);
  const inside = (x: number, y: number, inset: number) => {
    // equilateral triangle pointing up, shrunk by `inset`
    if (y < top + inset * 2 || y > bottom - inset) return false;
    const t = (y - top) / (bottom - top);
    return Math.abs(x - cx) <= t * half - inset * 1.15;
  };
  const bar = (x: number, y: number) => Math.abs(x - cx) < size * 0.035 && y > size * 0.38 && y < size * 0.66;
  const dot = (x: number, y: number) => Math.hypot(x - cx, y - size * 0.74) < size * 0.04;
  return render(
    size,
    size,
    (x, y) => {
      if (!inside(x, y, 0)) return SIGN_COLOURS.screen;
      if (!inside(x, y, size * 0.05)) return SIGN_COLOURS.ink;
      return bar(x, y) || dot(x, y) ? SIGN_COLOURS.ink : SIGN_COLOURS.yellow;
    },
    6,
    11,
  );
}

export function tagOnBlack(): RGBAImage {
  const text = "LP11";
  const glyphs = new Map(pixelFontGlyphs().map((g) => [String.fromCodePoint(g.codepoint), g.rows]));
  const cell = 12,
    pad = 16;
  const lit: [number, number][] = [];
  [...text].forEach((ch, i) =>
    glyphs.get(ch)!.forEach((row, r) => [...row].forEach((v, c) => v === "#" && lit.push([pad + (i * 6 + c) * cell + cell / 2, pad + r * cell + cell / 2]))),
  );
  const w = pad * 2 + text.length * 6 * cell,
    h = pad * 2 + 10 * cell;
  // soft round "spray" dots: coverage falls off over a few pixels
  return render(
    w,
    h,
    (x, y) => {
      let d = Infinity;
      for (const [px, py] of lit) d = Math.min(d, Math.hypot(x - px, y - py));
      const cover = Math.min(1, Math.max(0, (cell * 0.72 - d) / 3));
      return [0, 1, 2].map((k) => TAG_COLOURS.ground[k]! + (TAG_COLOURS.paint[k]! - TAG_COLOURS.ground[k]!) * cover) as RGB;
    },
    4,
    23,
  );
}
