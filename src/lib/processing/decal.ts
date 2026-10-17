/**
 * Decal and cutout pipeline (tool T07). Pure and deterministic.
 *
 *   source → rotate/flip → crop → key (colour or brightness) → edge cleanup
 *   (grow/shrink, despeckle, feather) → brush strokes → decontaminate edge
 *   colours → look (tint, adjust, grime, wear) → resize → bleed colour into
 *   transparent pixels
 *
 * Keying is by colour distance in OKLab or by brightness. There is no
 * "smart" subject detection.
 */
import { cloneImage, createImage, type RGB, type RGBAImage } from "./image";
import { rgbToOklab } from "./palette";
import { tileableFbm } from "./random";
import { fitTo, longSideSize, type Sampling } from "./resample";

export interface Stroke {
  mode: "erase" | "restore";
  /** Radius in working pixels (after crop). */
  r: number;
  /** 1 = hard edge, 0 = soft all the way to the centre. */
  hardness: number;
  points: [number, number][];
}

export interface DecalSettings {
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  flipV: boolean;
  /** In rotated-source pixels; null = whole image. */
  crop: { x: number; y: number; w: number; h: number } | null;
  key: "none" | "colour" | "luma";
  keyColours: RGB[];
  /** OKLab ΔE×100 within which a pixel is fully removed. */
  tolerance: number;
  /** Further ΔE range over which alpha ramps back to opaque. */
  softness: number;
  lumaThreshold: number;
  /** Keep dark areas instead of light ones. */
  lumaInvert: boolean;
  lumaSoftness: number;
  /** Positive grows the matte, negative shrinks it (pixels). */
  grow: number;
  /** Remove opaque islands smaller than this many pixels. */
  despeckle: number;
  feather: number;
  /** Remove the background colour mixed into semi-transparent edge pixels. */
  decontaminate: boolean;
  strokes: Stroke[];
  tint: RGB;
  tintAmount: number;
  brightness: number;
  contrast: number;
  saturation: number;
  grime: number;
  wear: number;
  seed: number;
  /** Output long side; 0 keeps the working size. */
  size: number;
  /** Pad the output to power-of-two sides (centred, transparent). */
  pot: boolean;
  sampling: Sampling;
  /** Fill transparent pixels' colour from the nearest visible pixel (prevents dark halos when filtered). */
  bleed: boolean;
}

export const DECAL_DEFAULTS: DecalSettings = {
  rotate: 0,
  flipH: false,
  flipV: false,
  crop: null,
  key: "colour",
  keyColours: [],
  tolerance: 12,
  softness: 10,
  lumaThreshold: 96,
  lumaInvert: false,
  lumaSoftness: 48,
  grow: 0,
  despeckle: 0,
  feather: 0,
  decontaminate: true,
  strokes: [],
  tint: [255, 255, 255],
  tintAmount: 0,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  grime: 0,
  wear: 0,
  seed: 1,
  size: 0,
  pot: false,
  sampling: "smooth",
  bleed: true,
};

export interface DecalResult {
  /** Rotated and cropped source (what strokes and picks refer to). */
  base: RGBAImage;
  /** Keyed and finished, at working size. */
  work: RGBAImage;
  /** Final output: resized, padded, colour-bled. */
  output: RGBAImage;
  /** Output alpha as an opaque grey image. */
  mask: RGBAImage;
}

/* ------------------------------------------------------------ geometry */

export function orient(img: RGBAImage, rot: DecalSettings["rotate"], flipH: boolean, flipV: boolean): RGBAImage {
  const { width: w, height: h, data: s } = img;
  const q = rot === 90 || rot === 270;
  const out = createImage(q ? h : w, q ? w : h);
  const W = out.width,
    H = out.height;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let nx = rot === 90 ? h - 1 - y : rot === 180 ? w - 1 - x : rot === 270 ? y : x;
      let ny = rot === 90 ? x : rot === 180 ? h - 1 - y : rot === 270 ? w - 1 - x : y;
      if (flipH) nx = W - 1 - nx;
      if (flipV) ny = H - 1 - ny;
      out.data.set(s.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), (ny * W + nx) * 4);
    }
  return out;
}

export function clampCrop(c: DecalSettings["crop"], w: number, h: number) {
  if (!c) return { x: 0, y: 0, w, h };
  const x = Math.max(0, Math.min(w - 1, Math.round(c.x))),
    y = Math.max(0, Math.min(h - 1, Math.round(c.y)));
  return { x, y, w: Math.max(1, Math.min(w - x, Math.round(c.w))), h: Math.max(1, Math.min(h - y, Math.round(c.h))) };
}

/* ---------------------------------------------------------------- matte */

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Alpha 0..1 per pixel from the key, times the source's own alpha. */
export function keyMatte(img: RGBAImage, s: DecalSettings): Float32Array {
  const d = img.data,
    n = img.width * img.height;
  const a = new Float32Array(n);
  const keys = s.keyColours.map(rgbToOklab);
  for (let i = 0; i < n; i++) {
    const r = d[i * 4]!,
      g = d[i * 4 + 1]!,
      b = d[i * 4 + 2]!,
      src = d[i * 4 + 3]! / 255;
    let v = 1;
    if (s.key === "colour" && keys.length) {
      const p = rgbToOklab([r, g, b]);
      let best = Infinity;
      for (const k of keys) best = Math.min(best, Math.hypot(p[0] - k[0], p[1] - k[1], p[2] - k[2]) * 100);
      v = s.softness > 0 ? Math.min(1, Math.max(0, (best - s.tolerance) / s.softness)) : best > s.tolerance ? 1 : 0;
    } else if (s.key === "luma") {
      const y = luma(r, g, b);
      const soft = Math.max(1, s.lumaSoftness);
      v = Math.min(1, Math.max(0, (y - (s.lumaThreshold - soft / 2)) / soft));
      if (s.lumaInvert) v = 1 - v;
    }
    a[i] = v * src;
  }
  return a;
}

/**
 * Separable max (grow) or min (shrink) filter with a square window. Pixels
 * outside the image are ignored, so a subject touching the edge isn't eaten
 * away from that side.
 */
export function morph(a: Float32Array, w: number, h: number, r: number): Float32Array {
  if (!r) return a;
  const grow = r > 0,
    k = Math.abs(r);
  const pick = grow ? Math.max : Math.min;
  const tmp = new Float32Array(a.length),
    out = new Float32Array(a.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = a[y * w + x]!;
      for (let dx = -k; dx <= k; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w) v = pick(v, a[y * w + xx]!);
      }
      tmp[y * w + x] = v;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]!;
      for (let dy = -k; dy <= k; dy++) {
        const yy = y + dy;
        if (yy >= 0 && yy < h) v = pick(v, tmp[yy * w + x]!);
      }
      out[y * w + x] = v;
    }
  return out;
}

/** Three box-blur passes (≈ Gaussian) of radius r. */
export function blurMatte(a: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r <= 0) return a;
  const cur = new Float32Array(a);
  const tmp = new Float32Array(a.length);
  const k = Math.max(1, Math.round(r / 1.7));
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      let sum = 0;
      for (let x = -k; x <= k; x++) sum += cur[y * w + Math.min(w - 1, Math.max(0, x))]!;
      for (let x = 0; x < w; x++) {
        tmp[y * w + x] = sum / (2 * k + 1);
        sum += cur[y * w + Math.min(w - 1, x + k + 1)]! - cur[y * w + Math.max(0, x - k)]!;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -k; y <= k; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!;
      for (let y = 0; y < h; y++) {
        cur[y * w + x] = sum / (2 * k + 1);
        sum += tmp[Math.min(h - 1, y + k + 1) * w + x]! - tmp[Math.max(0, y - k) * w + x]!;
      }
    }
  }
  return cur;
}

/** Clears 4-connected visible islands smaller than `min` pixels. */
export function despeckle(a: Float32Array, w: number, h: number, min: number): Float32Array {
  if (min <= 0) return a;
  const out = new Float32Array(a);
  const seen = new Uint8Array(a.length);
  const stack: number[] = [];
  for (let i = 0; i < a.length; i++) {
    if (seen[i] || a[i]! <= 0.02) continue;
    const comp: number[] = [];
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      comp.push(p);
      const x = p % w,
        y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1])
        if (q >= 0 && !seen[q] && a[q]! > 0.02) {
          seen[q] = 1;
          stack.push(q);
        }
    }
    if (comp.length < min) for (const p of comp) out[p] = 0;
  }
  return out;
}

/** Paints strokes into the matte. Returns how strongly each pixel was restored (null when nothing was). */
export function applyStrokes(a: Float32Array, w: number, h: number, strokes: Stroke[]): Float32Array | null {
  let restored: Float32Array | null = null;
  for (const st of strokes) {
    const r = Math.max(0.5, st.r),
      inner = r * Math.min(1, Math.max(0, st.hardness));
    const pts = st.points.length === 1 ? [st.points[0]!, st.points[0]!] : st.points;
    for (let s = 0; s + 1 < pts.length; s++) {
      const [x0, y0] = pts[s]!,
        [x1, y1] = pts[s + 1]!;
      const minX = Math.max(0, Math.floor(Math.min(x0, x1) - r)),
        maxX = Math.min(w - 1, Math.ceil(Math.max(x0, x1) + r));
      const minY = Math.max(0, Math.floor(Math.min(y0, y1) - r)),
        maxY = Math.min(h - 1, Math.ceil(Math.max(y0, y1) + r));
      const dx = x1 - x0,
        dy = y1 - y0,
        len2 = dx * dx + dy * dy;
      for (let y = minY; y <= maxY; y++)
        for (let x = minX; x <= maxX; x++) {
          const px = x + 0.5,
            py = y + 0.5;
          const t = len2 ? Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / len2)) : 0;
          const dist = Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy));
          if (dist > r) continue;
          const strength = dist <= inner ? 1 : 1 - (dist - inner) / (r - inner);
          const i = y * w + x;
          if (st.mode === "erase") {
            a[i] = a[i]! * (1 - strength);
            if (restored) restored[i] = restored[i]! * (1 - strength);
          } else {
            a[i] = Math.max(a[i]!, strength);
            restored ??= new Float32Array(a.length);
            restored[i] = Math.max(restored[i]!, strength);
          }
        }
    }
  }
  return restored;
}

/* --------------------------------------------------------------- colour */

/**
 * Edge clean-up for keyed images, by local foreground/background estimates.
 * The "sure" foreground is what the key kept fully, eroded 2 px away from
 * any edge; the "sure" background likewise. A pixel in between is treated
 * as a mix only when its colour lies close to the line between its local
 * background and foreground (so a partly keyed interior, or a colour
 * boundary inside the subject, keeps the key's alpha). Each mixed pixel gets
 * F (nearest sure-foreground colour) and B (nearest sure-background colour,
 * or the key colour when there's none), alpha is measured by projecting the
 * observed C onto the line from B to F (C = αF + (1 − α)B), and the colour
 * is unmixed: (C − (1 − α)B) / α, eased towards F as α falls. Fully
 * transparent pixels take F, so later feathering never reveals background
 * colour. Returns the refined alpha.
 */
export function refineEdges(img: RGBAImage, a: Float32Array, backgroundOf: (r: number, g: number, b: number) => RGB): Float32Array {
  const { width: w, height: h, data: d } = img;
  const n = a.length;
  const sureFg = morph(Float32Array.from(a, (v) => (v >= 0.98 ? 1 : 0)), w, h, -2);
  const sureBg = morph(Float32Array.from(a, (v) => (v <= 0.02 ? 1 : 0)), w, h, -2);
  const nearest = (sure: Float32Array) => {
    const m = createImage(w, h);
    let any = false;
    for (let i = 0; i < n; i++) {
      m.data[i * 4] = d[i * 4]!;
      m.data[i * 4 + 1] = d[i * 4 + 1]!;
      m.data[i * 4 + 2] = d[i * 4 + 2]!;
      if (sure[i]! > 0.5) {
        m.data[i * 4 + 3] = 255;
        any = true;
      }
    }
    if (!any) return null;
    bleed(m);
    return m.data;
  };
  const F = nearest(sureFg);
  const B = nearest(sureBg);
  if (!F || !B) return a;
  const out = new Float32Array(a);
  for (let i = 0; i < n; i++) {
    if (sureFg[i]! > 0.5) continue;
    const o = i * 4;
    if (sureBg[i]! > 0.5 || a[i]! <= 0) {
      // background: invisible, but coloured like the nearest subject pixel
      d[o] = F[o]!;
      d[o + 1] = F[o + 1]!;
      d[o + 2] = F[o + 2]!;
      out[i] = 0;
      continue;
    }
    const c0 = d[o]!,
      c1 = d[o + 1]!,
      c2 = d[o + 2]!;
    // the local background, unless it's a long way off in colour from the key
    const local = [B[o]!, B[o + 1]!, B[o + 2]!] as RGB;
    const keyed = backgroundOf(c0, c1, c2);
    const bg = Math.abs(local[0] - keyed[0]) + Math.abs(local[1] - keyed[1]) + Math.abs(local[2] - keyed[2]) < 240 ? local : keyed;
    const f0 = F[o]! - bg[0]!,
      f1 = F[o + 1]! - bg[1]!,
      f2 = F[o + 2]! - bg[2]!;
    const len2 = f0 * f0 + f1 * f1 + f2 * f2;
    if (len2 <= 400) continue; // foreground and background too alike to separate
    const t = ((c0 - bg[0]!) * f0 + (c1 - bg[1]!) * f1 + (c2 - bg[2]!) * f2) / len2;
    const tc = Math.min(1, Math.max(0, t));
    const residual = Math.hypot(c0 - bg[0]! - tc * f0, c1 - bg[1]! - tc * f1, c2 - bg[2]! - tc * f2);
    if (residual > 12 + 0.2 * Math.sqrt(len2)) continue; // not a mix of these two colours
    let al = tc;
    if (al < 0.03) al = 0;
    const C = [c0, c1, c2];
    for (let c = 0; c < 3; c++) {
      const unmixed = al > 0.05 ? Math.min(255, Math.max(0, (C[c]! - (1 - al) * bg[c]!) / al)) : F[o + c]!;
      d[o + c] = unmixed * al + F[o + c]! * (1 - al);
    }
    out[i] = al;
  }
  return out;
}

function look(img: RGBAImage, a: Float32Array, s: DecalSettings) {
  const d = img.data,
    w = img.width,
    h = img.height;
  const c = s.contrast >= 0 ? 1 + s.contrast / 50 : 1 + s.contrast / 100;
  const sat = 1 + s.saturation / 100,
    b = s.brightness * 2.55,
    t = s.tintAmount / 100;
  const busy = s.contrast || s.brightness || s.saturation || t || s.grime || s.wear;
  if (!busy) return;
  // wear chips away at edges: blurred alpha says how close to an edge a pixel is
  const edge = s.wear ? blurMatte(a, w, h, 6) : null;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x,
        o = i * 4;
      let r = d[o]!,
        g = d[o + 1]!,
        bl = d[o + 2]!;
      if (t) {
        const l = luma(r, g, bl) / 255;
        r = r * (1 - t) + s.tint[0] * l * t;
        g = g * (1 - t) + s.tint[1] * l * t;
        bl = bl * (1 - t) + s.tint[2] * l * t;
      }
      r = (r - 128) * c + 128 + b;
      g = (g - 128) * c + 128 + b;
      bl = (bl - 128) * c + 128 + b;
      if (sat !== 1) {
        const l = luma(r, g, bl);
        r = l + (r - l) * sat;
        g = l + (g - l) * sat;
        bl = l + (bl - l) * sat;
      }
      if (s.grime || s.wear) {
        const u = x / Math.max(w, h),
          v = y / Math.max(w, h);
        if (s.grime) {
          const n = tileableFbm(u, v, 6, 4, s.seed);
          const k = 1 - (s.grime / 100) * 0.75 * Math.max(0, n - 0.35) * 1.6;
          r *= k;
          g *= k;
          bl *= k;
        }
        if (s.wear && edge) {
          const n = tileableFbm(u, v, 16, 3, s.seed + 77);
          const near = 1 - Math.min(1, edge[i]!);
          if (n < (s.wear / 100) * (0.25 + 0.9 * near)) a[i] = 0;
        }
      }
      d[o] = r;
      d[o + 1] = g;
      d[o + 2] = bl;
    }
}

/** Gives every fully transparent pixel the colour of the nearest visible one (breadth-first). */
export function bleed(img: RGBAImage): void {
  const { width: w, height: h, data: d } = img;
  const n = w * h;
  const done = new Uint8Array(n);
  let queue: number[] = [];
  for (let i = 0; i < n; i++)
    if (d[i * 4 + 3]! > 0) {
      done[i] = 1;
      queue.push(i);
    }
  if (!queue.length) return;
  while (queue.length) {
    const next: number[] = [];
    for (const p of queue) {
      const x = p % w,
        y = (p / w) | 0;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q < 0 || done[q]) continue;
        done[q] = 1;
        d[q * 4] = d[p * 4]!;
        d[q * 4 + 1] = d[p * 4 + 1]!;
        d[q * 4 + 2] = d[p * 4 + 2]!;
        next.push(q);
      }
    }
    queue = next;
  }
}

const nextPot = (n: number) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/* ------------------------------------------------------------- pipeline */

export function processDecal(src: RGBAImage, settings: Partial<DecalSettings> = {}): DecalResult {
  const s: DecalSettings = { ...DECAL_DEFAULTS, ...settings };
  const oriented = orient(src, s.rotate, s.flipH, s.flipV);
  const c = clampCrop(s.crop, oriented.width, oriented.height);
  const base = createImage(c.w, c.h);
  for (let y = 0; y < c.h; y++) base.data.set(oriented.data.subarray(((c.y + y) * oriented.width + c.x) * 4, ((c.y + y) * oriented.width + c.x + c.w) * 4), y * c.w * 4);
  const { width: w, height: h } = base;

  const work = cloneImage(base);
  let a = keyMatte(base, s);
  if (s.decontaminate && s.key !== "none") {
    const keys = s.keyColours.map((k) => ({ rgb: k, lab: rgbToOklab(k) }));
    const background =
      s.key === "luma"
        ? () => (s.lumaInvert ? ([255, 255, 255] as RGB) : ([0, 0, 0] as RGB))
        : (r: number, g: number, b: number): RGB => {
            if (keys.length === 1) return keys[0]!.rgb;
            const p = rgbToOklab([r, g, b]);
            let best = keys[0]!,
              bd = Infinity;
            for (const k of keys) {
              const dist = (p[0] - k.lab[0]) ** 2 + (p[1] - k.lab[1]) ** 2 + (p[2] - k.lab[2]) ** 2;
              if (dist < bd) {
                bd = dist;
                best = k;
              }
            }
            return best.rgb;
          };
    if (s.key === "luma" || keys.length) a = refineEdges(work, a, background);
  }
  a = morph(a, w, h, Math.round(s.grow));
  a = despeckle(a, w, h, s.despeckle);
  a = blurMatte(a, w, h, s.feather);
  // restore strokes bring back the original pixels, not the cleaned edge colours
  const restored = applyStrokes(a, w, h, s.strokes);
  if (restored)
    for (let i = 0; i < restored.length; i++) {
      const t = restored[i]!;
      if (t > 0) for (let c = 0; c < 3; c++) work.data[i * 4 + c] = work.data[i * 4 + c]! * (1 - t) + base.data[i * 4 + c]! * t;
    }
  look(work, a, s);
  for (let i = 0; i < a.length; i++) work.data[i * 4 + 3] = Math.round(Math.min(1, Math.max(0, a[i]!)) * 255);

  let output = work;
  if (s.size > 0) {
    const [ow, oh] = longSideSize(w, h, s.size);
    output = fitTo(work, ow, oh, "stretch", s.sampling);
  }
  if (s.pot) {
    const W = nextPot(output.width),
      H = nextPot(output.height);
    if (W !== output.width || H !== output.height) {
      const padded = createImage(W, H);
      const ox = (W - output.width) >> 1,
        oy = (H - output.height) >> 1;
      for (let y = 0; y < output.height; y++) padded.data.set(output.data.subarray(y * output.width * 4, (y + 1) * output.width * 4), ((oy + y) * W + ox) * 4);
      output = padded;
    }
  }
  if (output === work) output = cloneImage(work);
  if (s.bleed) bleed(output);
  else for (let i = 0; i < output.data.length; i += 4) if (!output.data[i + 3]) output.data[i] = output.data[i + 1] = output.data[i + 2] = 0;

  const mask = createImage(output.width, output.height);
  for (let i = 0; i < output.data.length; i += 4) {
    const v = output.data[i + 3]!;
    mask.data[i] = mask.data[i + 1] = mask.data[i + 2] = v;
    mask.data[i + 3] = 255;
  }
  return { base, work, output, mask };
}

/** Box of pixels with alpha above 1%, for "trim to subject". */
export function subjectBounds(img: RGBAImage): { x: number; y: number; w: number; h: number } | null {
  let x0 = img.width,
    y0 = img.height,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++)
      if (img.data[(y * img.width + x) * 4 + 3]! > 2) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Median colour of 4×4 patches in the four corners, when they agree: probably the background. */
export function cornerColour(img: RGBAImage): RGB | null {
  const { width: w, height: h, data } = img;
  if (w < 8 || h < 8) return null;
  const patch = (x0: number, y0: number): RGB => {
    const px: RGB[] = [];
    for (let y = y0; y < y0 + 4; y++) for (let x = x0; x < x0 + 4; x++) px.push([data[(y * w + x) * 4]!, data[(y * w + x) * 4 + 1]!, data[(y * w + x) * 4 + 2]!]);
    return [0, 1, 2].map((c) => px.map((p) => p[c]!).sort((a, b) => a - b)[8]!) as RGB;
  };
  const cs = [patch(0, 0), patch(w - 4, 0), patch(0, h - 4), patch(w - 4, h - 4)];
  const lab = cs.map(rgbToOklab);
  if (lab.some((c) => Math.hypot(c[0] - lab[0]![0], c[1] - lab[0]![1], c[2] - lab[0]![2]) * 100 > 6)) return null;
  return [0, 1, 2].map((c) => Math.round(cs.reduce((n, x) => n + x[c]!, 0) / 4)) as RGB;
}

export const OUTPUT_SIZES = [0, 64, 128, 256, 512, 1024];
