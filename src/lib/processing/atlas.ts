/**
 * Texture atlas packing and composition (tool T03). Pure and deterministic:
 * the same tiles and settings always give the same layout and pixels.
 *
 * Geometry. Each tile's content (w×h) is surrounded by `extrude` pixels
 * copied from its own edges, so bilinear filtering and mipmaps sample the
 * tile's colour instead of a neighbour's. Footprints are separated by
 * `padding` transparent pixels and kept `border` pixels from the atlas edge.
 */
import { createImage, type RGBAImage } from "./image";

export type Rotation = 0 | 90 | 180 | 270;

/* ------------------------------------------------------------ tile edits */

/** Rotates clockwise by a multiple of 90°. */
export function rotate(img: RGBAImage, deg: Rotation): RGBAImage {
  if (deg === 0) return img;
  const { width: w, height: h, data: s } = img;
  const quarter = deg === 90 || deg === 270;
  const out = createImage(quarter ? h : w, quarter ? w : h);
  const W = out.width;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [nx, ny] = deg === 90 ? [h - 1 - y, x] : deg === 180 ? [w - 1 - x, h - 1 - y] : [y, w - 1 - x];
      const si = (y * w + x) * 4,
        di = (ny * W + nx) * 4;
      out.data[di] = s[si]!;
      out.data[di + 1] = s[si + 1]!;
      out.data[di + 2] = s[si + 2]!;
      out.data[di + 3] = s[si + 3]!;
    }
  return out;
}

/** Bounding box of pixels with alpha > 0, or null when fully transparent. */
export function opaqueBounds(img: RGBAImage): { x: number; y: number; w: number; h: number } | null {
  const { width: w, height: h, data } = img;
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[(y * w + x) * 4 + 3]! > 0) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function cropImage(img: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
  const out = createImage(w, h);
  for (let r = 0; r < h; r++) out.data.set(img.data.subarray(((y + r) * img.width + x) * 4, ((y + r) * img.width + x + w) * 4), r * w * 4);
  return out;
}

/** Trims fully transparent borders (a fully transparent tile becomes 1×1). */
export function trimTransparent(img: RGBAImage): RGBAImage {
  const b = opaqueBounds(img);
  if (!b) return createImage(1, 1);
  return b.w === img.width && b.h === img.height ? img : cropImage(img, b.x, b.y, b.w, b.h);
}

/** Composites onto a solid colour, making every pixel opaque. */
export function flatten(img: RGBAImage, [r, g, b]: [number, number, number]): RGBAImage {
  const out = createImage(img.width, img.height);
  const s = img.data,
    d = out.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]! / 255;
    d[i] = s[i]! * a + r * (1 - a);
    d[i + 1] = s[i + 1]! * a + g * (1 - a);
    d[i + 2] = s[i + 2]! * a + b * (1 - a);
    d[i + 3] = 255;
  }
  return out;
}

/* ---------------------------------------------------------------- packing */

export interface PackSettings {
  method: "grid" | "maxrects";
  /** Grid columns; 0 = as square as possible. */
  columns: number;
  /** MaxRects may turn tiles 90° clockwise to fit better. */
  allowRotate: boolean;
  padding: number;
  border: number;
  extrude: number;
  size: "auto" | "manual";
  width: number;
  height: number;
  /** Auto size: round each side up to a power of two. */
  pot: boolean;
  /** Auto size: width = height. */
  square: boolean;
}

export const PACK_DEFAULTS: PackSettings = { method: "maxrects", columns: 0, allowRotate: false, padding: 2, border: 0, extrude: 1, size: "auto", width: 512, height: 512, pot: true, square: false };

export const MAX_ATLAS = 8192;

export interface PackInput {
  w: number;
  h: number;
}

export interface Placement {
  /** Index into the input list. */
  index: number;
  /** Content rectangle (without extrusion), in atlas pixels from the top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** True when the tile is stored turned 90° clockwise. */
  rotated: boolean;
}

export interface PackResult {
  width: number;
  height: number;
  placements: Placement[];
  /** Indices of tiles that don't fit (manual size, or larger than the maximum atlas). */
  overflow: number[];
}

interface FreeRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** MaxRects bin packing, best-short-side-fit, deterministic tie-breaks. Sizes are footprints. */
function maxRects(items: { index: number; w: number; h: number }[], binW: number, binH: number, allowRotate: boolean) {
  let free: FreeRect[] = [{ x: 0, y: 0, w: binW, h: binH }];
  const placed: { index: number; x: number; y: number; w: number; h: number; rotated: boolean }[] = [];
  const left: number[] = [];
  for (const it of items) {
    let best: { x: number; y: number; w: number; h: number; rotated: boolean; s: number; l: number } | null = null;
    for (const f of free)
      for (const rot of allowRotate && it.w !== it.h ? [false, true] : [false]) {
        const w = rot ? it.h : it.w,
          h = rot ? it.w : it.h;
        if (w > f.w || h > f.h) continue;
        const s = Math.min(f.w - w, f.h - h),
          l = Math.max(f.w - w, f.h - h);
        if (!best || s < best.s || (s === best.s && (l < best.l || (l === best.l && (f.y < best.y || (f.y === best.y && f.x < best.x)))))) best = { x: f.x, y: f.y, w, h, rotated: rot, s, l };
      }
    if (!best) {
      left.push(it.index);
      continue;
    }
    const r = best;
    placed.push({ index: it.index, x: r.x, y: r.y, w: r.w, h: r.h, rotated: r.rotated });
    // split every free rect the new one overlaps
    const next: FreeRect[] = [];
    for (const f of free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
        next.push(f);
        continue;
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - r.x - r.w, h: f.h });
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - r.y - r.h });
    }
    // drop free rects contained in others
    free = next.filter((a, i) => !next.some((b, j) => j !== i && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (j < i || a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h)));
  }
  return { placed, left };
}

const nextPot = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Packs content sizes into an atlas. Placement order and positions depend only on the inputs. */
export function pack(items: PackInput[], s: PackSettings): PackResult {
  const e = Math.max(0, s.extrude | 0),
    p = Math.max(0, s.padding | 0),
    b = Math.max(0, s.border | 0);
  // footprint = content + extrusion on both sides + trailing padding
  const fp = items.map((it, index) => ({ index, w: it.w + 2 * e + p, h: it.h + 2 * e + p }));
  const toPlacement = (index: number, fx: number, fy: number, rotated: boolean): Placement => {
    const it = items[index]!;
    return { index, x: fx + b + e, y: fy + b + e, w: rotated ? it.h : it.w, h: rotated ? it.w : it.h, rotated };
  };
  const finish = (w: number, h: number) => {
    let W = w + 2 * b - p,
      H = h + 2 * b - p;
    W = Math.max(1, W);
    H = Math.max(1, H);
    if (s.size === "auto") {
      if (s.square) W = H = Math.max(W, H);
      if (s.pot) {
        W = nextPot(W);
        H = nextPot(H);
        if (s.square) W = H = Math.max(W, H);
      }
    }
    return [W, H] as const;
  };
  if (!items.length) return { width: 1, height: 1, placements: [], overflow: [] };

  if (s.method === "grid") {
    const cw = Math.max(...fp.map((f) => f.w)),
      ch = Math.max(...fp.map((f) => f.h));
    let cols = s.columns > 0 ? s.columns : Math.ceil(Math.sqrt(items.length));
    if (s.size === "manual") cols = Math.max(1, Math.floor((s.width - 2 * b + p) / cw));
    const rows = Math.ceil(items.length / cols);
    const placements: Placement[] = [];
    const overflow: number[] = [];
    let [W, H] = s.size === "manual" ? [s.width, s.height] : finish(cols * cw, rows * ch);
    if (W > MAX_ATLAS || H > MAX_ATLAS) [W, H] = [Math.min(W, MAX_ATLAS), Math.min(H, MAX_ATLAS)];
    fp.forEach((f, i) => {
      const fx = (i % cols) * cw,
        fy = Math.floor(i / cols) * ch;
      // centre smaller tiles in their cell
      const pl = toPlacement(i, fx + ((cw - f.w) >> 1), fy + ((ch - f.h) >> 1), false);
      if (pl.x + pl.w + e > W - b || pl.y + pl.h + e > H - b) overflow.push(i);
      else placements.push(pl);
    });
    return { width: W, height: H, placements, overflow };
  }

  // MaxRects: tallest first, then widest, then input order
  const order = [...fp].sort((a, c) => Math.max(c.w, c.h) - Math.max(a.w, a.h) || c.h - a.h || c.w - a.w || a.index - c.index);
  const tooBig = order.filter((f) => Math.min(f.w, f.h) - p + 2 * b > MAX_ATLAS || (!s.allowRotate && (f.w - p + 2 * b > MAX_ATLAS || f.h - p + 2 * b > MAX_ATLAS)));
  const fit = order.filter((f) => !tooBig.includes(f));

  const attempt = (binW: number, binH: number) => maxRects(fit, binW + p - 2 * b, binH + p - 2 * b, s.allowRotate);
  const done = (W: number, H: number, r: ReturnType<typeof attempt>): PackResult => ({
    width: W,
    height: H,
    placements: r.placed.map((q) => toPlacement(q.index, q.x, q.y, q.rotated)).sort((a, c) => a.index - c.index),
    overflow: [...r.left, ...tooBig.map((f) => f.index)].sort((a, c) => a - c),
  });

  if (s.size === "manual") return done(s.width, s.height, attempt(s.width, s.height));

  const area = fit.reduce((n, f) => n + f.w * f.h, 0);
  const minSide = Math.max(1, ...fit.map((f) => Math.min(f.w, f.h) - p + 2 * b), ...fit.map((f) => (s.allowRotate ? 0 : f.w - p + 2 * b)));
  if (s.pot || s.square) {
    // smallest candidate (by area, then squareness) that holds everything
    const sides = s.pot ? Array.from({ length: 14 }, (_, k) => 2 ** k).filter((v) => v <= MAX_ATLAS) : null;
    const cands: [number, number][] = [];
    if (sides) {
      for (const w of sides) for (const h of sides) if (!s.square || w === h) cands.push([w, h]);
    } else {
      for (let side = Math.max(minSide, Math.ceil(Math.sqrt(area))); side <= MAX_ATLAS; side = Math.ceil(side * 1.05) + 1) cands.push([side, side]);
    }
    cands.sort((a, c) => a[0] * a[1] - c[0] * c[1] || Math.abs(a[0] - a[1]) - Math.abs(c[0] - c[1]) || c[0] - a[0]);
    for (const [w, h] of cands) {
      // the free area of the bin must at least hold every footprint
      if ((w + p - 2 * b) * (h + p - 2 * b) < area || w < minSide) continue;
      const r = attempt(w, h);
      if (!r.left.length) return done(w, h, r);
    }
    return done(MAX_ATLAS, MAX_ATLAS, attempt(MAX_ATLAS, MAX_ATLAS));
  }
  // free size: fixed width near √area, unbounded height, then trim to the used box
  let width = Math.max(minSide, Math.ceil(Math.sqrt(area * 1.15)));
  for (;;) {
    const r = attempt(width, MAX_ATLAS);
    if (!r.left.length || width >= MAX_ATLAS) {
      const usedW = Math.max(...r.placed.map((q) => q.x + q.w), 1) - p + 2 * b;
      const usedH = Math.max(...r.placed.map((q) => q.y + q.h), 1) - p + 2 * b;
      return done(Math.max(1, usedW), Math.max(1, usedH), r);
    }
    width = Math.min(MAX_ATLAS, Math.ceil(width * 1.25));
  }
}

/* ------------------------------------------------------------ composition */

/**
 * Draws tiles into the atlas at their placements, rotating where the packer
 * did, and extrudes `extrude` pixels of each tile's edge outward.
 */
export function compose(tiles: RGBAImage[], result: PackResult, extrude: number): RGBAImage {
  const atlas = createImage(result.width, result.height);
  const W = atlas.width,
    H = atlas.height,
    d = atlas.data;
  for (const pl of result.placements) {
    const img = pl.rotated ? rotate(tiles[pl.index]!, 90) : tiles[pl.index]!;
    for (let y = -extrude; y < pl.h + extrude; y++) {
      const ay = pl.y + y;
      if (ay < 0 || ay >= H) continue;
      const sy = Math.min(pl.h - 1, Math.max(0, y));
      for (let x = -extrude; x < pl.w + extrude; x++) {
        const ax = pl.x + x;
        if (ax < 0 || ax >= W) continue;
        const sx = Math.min(pl.w - 1, Math.max(0, x));
        const si = (sy * img.width + sx) * 4,
          di = (ay * W + ax) * 4;
        d[di] = img.data[si]!;
        d[di + 1] = img.data[si + 1]!;
        d[di + 2] = img.data[si + 2]!;
        d[di + 3] = img.data[si + 3]!;
      }
    }
  }
  return atlas;
}
