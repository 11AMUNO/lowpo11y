/**
 * Deterministic resampling on RGBA buffers (same bytes in every browser and
 * in Node, unlike canvas smoothing).
 * - nearest: picks the source texel under each output pixel centre.
 * - smooth: separable triangle filter widened by the scale factor (area
 *   averaging when shrinking, bilinear when enlarging), in premultiplied
 *   alpha so transparent pixels never darken edges.
 */
import { assertDimensions, createImage, type RGBAImage } from "./image";

export type Sampling = "nearest" | "smooth";
export type Fit = "stretch" | "crop" | "pad";

export function resizeNearest(src: RGBAImage, w: number, h: number): RGBAImage {
  assertDimensions(w, h);
  const out = createImage(w, h);
  const s = src.data,
    d = out.data;
  const xs = new Int32Array(w);
  for (let x = 0; x < w; x++) xs[x] = Math.min(src.width - 1, Math.floor(((x + 0.5) * src.width) / w));
  for (let y = 0; y < h; y++) {
    const sy = Math.min(src.height - 1, Math.floor(((y + 0.5) * src.height) / h));
    const row = sy * src.width;
    for (let x = 0; x < w; x++) {
      const i = (row + xs[x]!) * 4,
        j = (y * w + x) * 4;
      d[j] = s[i]!;
      d[j + 1] = s[i + 1]!;
      d[j + 2] = s[i + 2]!;
      d[j + 3] = s[i + 3]!;
    }
  }
  return out;
}

interface Contrib {
  start: Int32Array;
  count: Int32Array;
  weights: Float32Array;
  stride: number;
}

/** Normalised triangle-filter weights for each output index along one axis. */
function contributions(srcLen: number, dstLen: number): Contrib {
  const scale = dstLen / srcLen;
  const support = scale < 1 ? 1 / scale : 1;
  const stride = Math.ceil(support * 2) + 2;
  const start = new Int32Array(dstLen),
    count = new Int32Array(dstLen),
    weights = new Float32Array(dstLen * stride);
  for (let o = 0; o < dstLen; o++) {
    const centre = (o + 0.5) / scale;
    const lo = Math.max(0, Math.floor(centre - support)),
      hi = Math.min(srcLen - 1, Math.ceil(centre + support));
    let sum = 0,
      n = 0;
    for (let i = lo; i <= hi && n < stride; i++) {
      const wgt = Math.max(0, 1 - Math.abs(i + 0.5 - centre) / support);
      if (wgt <= 0) continue;
      if (n === 0) start[o] = i;
      weights[o * stride + n] = wgt;
      sum += wgt;
      n++;
    }
    if (n === 0) {
      start[o] = Math.min(srcLen - 1, Math.max(0, Math.floor(centre)));
      weights[o * stride] = 1;
      n = 1;
      sum = 1;
    }
    for (let k = 0; k < n; k++) weights[o * stride + k]! /= sum;
    count[o] = n;
  }
  return { start, count, weights, stride };
}

export function resizeSmooth(src: RGBAImage, w: number, h: number): RGBAImage {
  assertDimensions(w, h);
  const sw = src.width,
    sh = src.height;
  // premultiply into floats
  const pm = new Float32Array(sw * sh * 4);
  const s = src.data;
  for (let i = 0; i < s.length; i += 4) {
    const a = s[i + 3]! / 255;
    pm[i] = s[i]! * a;
    pm[i + 1] = s[i + 1]! * a;
    pm[i + 2] = s[i + 2]! * a;
    pm[i + 3] = s[i + 3]!;
  }
  // horizontal pass: sw×sh → w×sh
  const cx = contributions(sw, w);
  const tmp = new Float32Array(w * sh * 4);
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      const st = cx.start[x]!,
        n = cx.count[x]!,
        base = x * cx.stride;
      for (let k = 0; k < n; k++) {
        const wgt = cx.weights[base + k]!,
          i = (y * sw + st + k) * 4;
        r += pm[i]! * wgt;
        g += pm[i + 1]! * wgt;
        b += pm[i + 2]! * wgt;
        a += pm[i + 3]! * wgt;
      }
      const j = (y * w + x) * 4;
      tmp[j] = r;
      tmp[j + 1] = g;
      tmp[j + 2] = b;
      tmp[j + 3] = a;
    }
  // vertical pass: w×sh → w×h, then un-premultiply
  const cy = contributions(sh, h);
  const out = createImage(w, h);
  const d = out.data;
  for (let y = 0; y < h; y++) {
    const st = cy.start[y]!,
      n = cy.count[y]!,
      base = y * cy.stride;
    for (let x = 0; x < w; x++) {
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let k = 0; k < n; k++) {
        const wgt = cy.weights[base + k]!,
          i = ((st + k) * w + x) * 4;
        r += tmp[i]! * wgt;
        g += tmp[i + 1]! * wgt;
        b += tmp[i + 2]! * wgt;
        a += tmp[i + 3]! * wgt;
      }
      const j = (y * w + x) * 4;
      const alpha = Math.round(a);
      if (alpha <= 0) {
        d[j] = d[j + 1] = d[j + 2] = d[j + 3] = 0;
        continue;
      }
      const inv = 255 / a;
      d[j] = Math.round(r * inv);
      d[j + 1] = Math.round(g * inv);
      d[j + 2] = Math.round(b * inv);
      d[j + 3] = alpha;
    }
  }
  return out;
}

export function resize(src: RGBAImage, w: number, h: number, sampling: Sampling): RGBAImage {
  if (w === src.width && h === src.height) return { width: w, height: h, data: new Uint8ClampedArray(src.data) };
  return sampling === "nearest" ? resizeNearest(src, w, h) : resizeSmooth(src, w, h);
}

export function crop(src: RGBAImage, x: number, y: number, w: number, h: number): RGBAImage {
  assertDimensions(w, h);
  const out = createImage(w, h);
  for (let row = 0; row < h; row++) {
    const from = ((y + row) * src.width + x) * 4;
    out.data.set(src.data.subarray(from, from + w * 4), row * w * 4);
  }
  return out;
}

/**
 * Exactly w×h output. stretch ignores aspect; crop fills and trims the
 * centre; pad fits inside and leaves transparent margins (centred).
 */
export function fitTo(src: RGBAImage, w: number, h: number, fit: Fit, sampling: Sampling): RGBAImage {
  assertDimensions(w, h);
  if (fit === "stretch") return resize(src, w, h, sampling);
  const sx = w / src.width,
    sy = h / src.height;
  if (fit === "crop") {
    const k = Math.max(sx, sy);
    // crop the source to the target aspect first so no edge pixels bleed in
    const cw = Math.min(src.width, Math.round(w / k)),
      ch = Math.min(src.height, Math.round(h / k));
    const cropped = crop(src, Math.floor((src.width - cw) / 2), Math.floor((src.height - ch) / 2), Math.max(1, cw), Math.max(1, ch));
    return resize(cropped, w, h, sampling);
  }
  const k = Math.min(sx, sy);
  const iw = Math.max(1, Math.round(src.width * k)),
    ih = Math.max(1, Math.round(src.height * k));
  const inner = resize(src, iw, ih, sampling);
  const out = createImage(w, h);
  const ox = Math.floor((w - iw) / 2),
    oy = Math.floor((h - ih) / 2);
  for (let row = 0; row < ih; row++) out.data.set(inner.data.subarray(row * iw * 4, (row + 1) * iw * 4), ((oy + row) * w + ox) * 4);
  return out;
}

/** Output size for a long-side target, keeping aspect (at least 1 px). */
export function longSideSize(w: number, h: number, longSide: number): [number, number] {
  const k = longSide / Math.max(w, h);
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}
