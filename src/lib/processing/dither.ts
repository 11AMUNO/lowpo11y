import { cloneImage, type RGBAImage } from "./image";

/**
 * Normalised Bayer threshold matrix of size n×n (n = 2, 4 or 8), values in (0,1).
 * Generated recursively so every size uses the canonical ordering.
 */
export function bayerMatrix(n: 2 | 4 | 8): number[][] {
  let m: number[][] = [
    [0, 2],
    [3, 1],
  ];
  while (m.length < n) {
    const size = m.length;
    const next: number[][] = Array.from({ length: size * 2 }, () => new Array<number>(size * 2).fill(0));
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const v = m[y]![x]! * 4;
        next[y]![x] = v;
        next[y]![x + size] = v + 2;
        next[y + size]![x] = v + 3;
        next[y + size]![x + size] = v + 1;
      }
    m = next;
  }
  const cells = n * n;
  return m.map((row) => row.map((v) => (v + 0.5) / cells));
}

/**
 * Reduce each colour channel to `levels` evenly spaced values using ordered
 * (Bayer) dithering. `strength` 0 = plain posterise, 1 = full dither spread.
 * Alpha is preserved untouched. Deterministic.
 */
export function posterizeOrdered(img: RGBAImage, levels: number, matrixSize: 2 | 4 | 8 = 4, strength = 1): RGBAImage {
  if (levels < 2 || levels > 256) throw new RangeError("levels must be between 2 and 256");
  const out = cloneImage(img);
  const m = bayerMatrix(matrixSize);
  const step = 255 / (levels - 1);
  const d = out.data;
  for (let y = 0; y < out.height; y++) {
    const row = m[y % matrixSize]!;
    for (let x = 0; x < out.width; x++) {
      const t = (row[x % matrixSize]! - 0.5) * strength;
      const i = (y * out.width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v = d[i + c]! / step + t;
        d[i + c] = Math.round(Math.min(levels - 1, Math.max(0, Math.round(v))) * step);
      }
    }
  }
  return out;
}
