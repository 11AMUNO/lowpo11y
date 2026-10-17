/**
 * Colour reduction primitives: per-channel bit depth, median-cut palettes and
 * nearest-colour lookup with a 6-bit-per-channel cache. Deterministic.
 */
import type { RGB, RGBAImage } from "./image";

/** Reduce one 8-bit value to `bits` and expand back by bit replication (e.g. RGB555 → 0..255). */
export function quantizeChannel(v: number, bits: number): number {
  if (bits >= 8) return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
  const max = (1 << bits) - 1;
  const q = Math.round(((v < 0 ? 0 : v > 255 ? 255 : v) / 255) * max);
  // replicate the top bits into the low bits so full scale maps to 255 (RGB555: q<<3 | q>>2)
  let out = q << (8 - bits);
  for (let s = bits; s < 8; s += bits) out |= out >> s;
  return out & 255;
}

export interface BitDepth {
  r: number;
  g: number;
  b: number;
}

/**
 * Median-cut palette from the opaque pixels of an image (alpha > 0),
 * sampling at most ~120k pixels. Boxes split on their widest channel,
 * weighted by population. Returns up to `count` unique colours.
 */
export function medianCut(img: RGBAImage, count: number, snap?: (c: RGB) => RGB): RGB[] {
  const d = img.data;
  const total = d.length / 4;
  const step = Math.max(1, Math.floor(total / 120000));
  const R: number[] = [],
    G: number[] = [],
    B: number[] = [];
  for (let i = 0; i < total; i += step) {
    const j = i * 4;
    if (d[j + 3] === 0) continue;
    R.push(d[j]!);
    G.push(d[j + 1]!);
    B.push(d[j + 2]!);
  }
  if (!R.length) return [[0, 0, 0]];
  const ch = [R, G, B];
  const range = (idx: number[]) => {
    let best = -1,
      axis = 0;
    for (let c = 0; c < 3; c++) {
      let lo = 255,
        hi = 0;
      for (const i of idx) {
        const v = ch[c]![i]!;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > best) {
        best = hi - lo;
        axis = c;
      }
    }
    return { span: best, axis };
  };
  const all = R.map((_, i) => i);
  const boxes = [{ idx: all, r: range(all) }];
  while (boxes.length < count) {
    let bi = -1,
      score = 0;
    boxes.forEach((b, i) => {
      const sc = b.r.span * Math.sqrt(b.idx.length);
      if (b.idx.length > 1 && b.r.span > 0 && sc > score) {
        score = sc;
        bi = i;
      }
    });
    if (bi < 0) break;
    const b = boxes[bi]!,
      a = ch[b.r.axis]!;
    b.idx.sort((x, y) => a[x]! - a[y]! || x - y);
    const mid = b.idx.length >> 1;
    const lo = b.idx.slice(0, mid),
      hi = b.idx.slice(mid);
    boxes.splice(bi, 1, { idx: lo, r: range(lo) }, { idx: hi, r: range(hi) });
  }
  const seen = new Set<string>();
  const out: RGB[] = [];
  for (const b of boxes) {
    let r = 0,
      g = 0,
      bl = 0;
    for (const i of b.idx) {
      r += R[i]!;
      g += G[i]!;
      bl += B[i]!;
    }
    const n = b.idx.length;
    let c: RGB = [Math.round(r / n), Math.round(g / n), Math.round(bl / n)];
    if (snap) c = snap(c);
    const k = c.join();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(c);
    }
  }
  return out;
}

/** Nearest palette colour by luma-weighted RGB distance, cached per 6-bit cell. */
export function paletteMatcher(palette: RGB[]): (r: number, g: number, b: number) => RGB {
  const cache = new Int16Array(1 << 18).fill(-1);
  return (r, g, b) => {
    r = r < 0 ? 0 : r > 255 ? 255 : r | 0;
    g = g < 0 ? 0 : g > 255 ? 255 : g | 0;
    b = b < 0 ? 0 : b > 255 ? 255 : b | 0;
    const key = ((r >> 2) << 12) | ((g >> 2) << 6) | (b >> 2);
    let k = cache[key]!;
    if (k < 0) {
      let best = Infinity;
      for (let p = 0; p < palette.length; p++) {
        const c = palette[p]!,
          dr = r - c[0],
          dg = g - c[1],
          db = b - c[2];
        const dist = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
        if (dist < best) {
          best = dist;
          k = p;
        }
      }
      cache[key] = k;
    }
    return palette[k]!;
  };
}

/** Distinct opaque colours (alpha > 0) in an image. */
export function countColours(img: RGBAImage): number {
  const set = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 0) set.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
  return set.size;
}

/** Parses "#rrggbb" lists, GIMP .gpl files or "r g b" lines into colours. */
export function parsePalette(text: string): RGB[] {
  const out: RGB[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") && !/^#[0-9a-f]{6}\b/i.test(line)) continue;
    if (/^(GIMP Palette|Name:|Columns:)/i.test(line)) continue;
    for (const m of line.matchAll(/#?\b([0-9a-f]{6})\b/gi)) {
      const v = parseInt(m[1]!, 16);
      out.push([(v >> 16) & 255, (v >> 8) & 255, v & 255]);
    }
    if (!/[0-9a-f]{6}/i.test(line)) {
      const nums = line.split(/\s+/).slice(0, 3).map(Number);
      if (nums.length === 3 && nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) out.push(nums as RGB);
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.join()) ? false : (seen.add(c.join()), true))).slice(0, 256);
}
