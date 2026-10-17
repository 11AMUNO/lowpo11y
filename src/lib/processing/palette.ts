/**
 * Palette maths for the palette tool (T04): OKLab conversion, dominant-colour
 * extraction that honours locked colours, colour harmonies and
 * colour-vision-deficiency simulation. Pure and deterministic.
 */
import type { RGB, RGBAImage } from "./image";
import { medianCut } from "./quantize";

/* ------------------------------------------------------------------ OKLab */

export type Lab = [number, number, number];

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (v: number) => {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
};

const LIN = new Float64Array(256).map((_, i) => toLinear(i));

/** sRGB (0..255) → OKLab (Björn Ottosson, 2020). */
export function rgbToOklab([r, g, b]: RGB): Lab {
  const lr = LIN[r | 0]!,
    lg = LIN[g | 0]!,
    lb = LIN[b | 0]!;
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab → sRGB (0..255), clipped to the sRGB gamut. */
export function oklabToRgb([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    toSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}

/** Perceptual difference (ΔE in OKLab, ×100 so ~2 is a just-noticeable step). */
export function deltaE(a: RGB, b: RGB): number {
  const p = rgbToOklab(a),
    q = rgbToOklab(b);
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * 100;
}

/* ------------------------------------------------------------- extraction */

export interface ExtractOptions {
  count: number;
  /** Colours that must stay in the result, unchanged. They take slots from `count`. */
  locked?: RGB[];
  /** k-means refinement passes in OKLab after the median-cut start (0 = median cut only). */
  iterations?: number;
}

/**
 * Dominant colours of the visible pixels (alpha > 0). Pixels are binned into
 * a 5-bit-per-channel histogram, seeded by median cut and refined by
 * weighted k-means in OKLab. Locked colours act as fixed centres: pixels
 * near them are claimed by them, so free colours go to what's left.
 * Result: locked colours first (in their given order), then the rest from
 * dark to light.
 */
export function extractPalette(img: RGBAImage, o: ExtractOptions): RGB[] {
  const locked = (o.locked ?? []).slice(0, o.count);
  const free = Math.max(0, Math.min(256, o.count) - locked.length);
  // histogram: 32×32×32 bins with summed colour and count
  const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    const r = d[i]!,
      g = d[i + 1]!,
      b = d[i + 2]!;
    const k = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const e = bins.get(k);
    if (e) {
      e.n++;
      e.r += r;
      e.g += g;
      e.b += b;
    } else bins.set(k, { n: 1, r, g, b });
  }
  if (!bins.size || !free) return locked.map((c) => [...c] as RGB);
  const keys = [...bins.keys()].sort((a, b) => a - b);
  const pts = keys.map((k) => {
    const e = bins.get(k)!;
    const c: RGB = [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)];
    return { c, lab: rgbToOklab(c), n: e.n };
  });

  // start: median cut over the binned colours, skipping seeds too close to a locked colour
  const seedImg: RGBAImage = { width: pts.length, height: 1, data: new Uint8ClampedArray(pts.length * 4) };
  pts.forEach((p, i) => seedImg.data.set([...p.c, 255], i * 4));
  const lockedLab = locked.map(rgbToOklab);
  let seeds = medianCut(seedImg, free + locked.length).filter((c) => locked.every((l) => deltaE(c, l) > 3));
  seeds = seeds.slice(0, free);
  // fewer distinct colours than slots: return what exists
  const centres: Lab[] = [...lockedLab, ...seeds.map(rgbToOklab)];
  const fixed = locked.length;

  const iters = o.iterations ?? 8;
  const assign = new Int32Array(pts.length);
  for (let it = 0; it <= iters; it++) {
    for (let p = 0; p < pts.length; p++) {
      const q = pts[p]!.lab;
      let best = Infinity,
        bi = 0;
      for (let c = 0; c < centres.length; c++) {
        const z = centres[c]!;
        const dist = (q[0] - z[0]) ** 2 + (q[1] - z[1]) ** 2 + (q[2] - z[2]) ** 2;
        if (dist < best) {
          best = dist;
          bi = c;
        }
      }
      assign[p] = bi;
    }
    if (it === iters) break;
    const sum = centres.map(() => [0, 0, 0, 0]);
    for (let p = 0; p < pts.length; p++) {
      const s = sum[assign[p]!]!,
        { lab, n } = pts[p]!;
      s[0]! += lab[0] * n;
      s[1]! += lab[1] * n;
      s[2]! += lab[2] * n;
      s[3]! += n;
    }
    for (let c = fixed; c < centres.length; c++) {
      const s = sum[c]!;
      if (s[3]! > 0) centres[c] = [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!];
    }
  }
  // free centres → the population-weighted mean colour of their members, in sRGB
  const out: RGB[] = [];
  const seen = new Set(locked.map((c) => c.join()));
  for (let c = fixed; c < centres.length; c++) {
    let r = 0,
      g = 0,
      b = 0,
      n = 0;
    for (let p = 0; p < pts.length; p++)
      if (assign[p] === c) {
        const pt = pts[p]!;
        r += pt.c[0] * pt.n;
        g += pt.c[1] * pt.n;
        b += pt.c[2] * pt.n;
        n += pt.n;
      }
    if (!n) continue;
    const col: RGB = [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    if (seen.has(col.join())) continue;
    seen.add(col.join());
    out.push(col);
  }
  out.sort((a, b) => rgbToOklab(a)[0] - rgbToOklab(b)[0] || a.join().localeCompare(b.join()));
  return [...locked.map((c) => [...c] as RGB), ...out];
}

/* -------------------------------------------------------------- harmonies */

export type Harmony = "complementary" | "analogous" | "triadic" | "split" | "tetradic" | "shades";

export const HARMONIES: { id: Harmony; label: string; description: string }[] = [
  { id: "complementary", label: "Complementary", description: "The opposite hue" },
  { id: "analogous", label: "Analogous", description: "Neighbours 30° either side" },
  { id: "triadic", label: "Triadic", description: "Three hues 120° apart" },
  { id: "split", label: "Split", description: "The two hues beside the complement" },
  { id: "tetradic", label: "Tetradic", description: "Four hues 90° apart" },
  { id: "shades", label: "Shades", description: "Same hue, darker to lighter" },
];

/** Colours that go with `base`, by rotating hue in OKLCh (lightness and chroma kept). Excludes `base`. */
export function harmony(base: RGB, kind: Harmony): RGB[] {
  const [L, a, b] = rgbToOklab(base);
  const C = Math.hypot(a, b),
    h = Math.atan2(b, a);
  const at = (deg: number, l = L): RGB => {
    const t = h + (deg * Math.PI) / 180;
    return oklabToRgb([l, C * Math.cos(t), C * Math.sin(t)]);
  };
  switch (kind) {
    case "complementary":
      return [at(180)];
    case "analogous":
      return [at(-30), at(30)];
    case "triadic":
      return [at(120), at(240)];
    case "split":
      return [at(150), at(210)];
    case "tetradic":
      return [at(90), at(180), at(270)];
    case "shades":
      return [0.25, 0.45, 0.65, 0.85].filter((l) => Math.abs(l - L) > 0.06).map((l) => at(0, l));
  }
}

/* ----------------------------------------------------- colour-vision deficiency */

export type Cvd = "protanopia" | "deuteranopia" | "tritanopia";

export const CVD_LABEL: Record<Cvd, string> = {
  protanopia: "Protanopia (no red cones)",
  deuteranopia: "Deuteranopia (no green cones)",
  tritanopia: "Tritanopia (no blue cones)",
};

// Machado, Oliveira & Fernandes (2009), severity 1.0, applied in linear RGB
const CVD: Record<Cvd, number[]> = {
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritanopia: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
};

/** Approximates how a colour looks with full dichromacy. An aid, not a diagnosis. */
export function simulateCvd([r, g, b]: RGB, kind: Cvd): RGB {
  const m = CVD[kind]!;
  const lr = LIN[r]!,
    lg = LIN[g]!,
    lb = LIN[b]!;
  return [toSrgb(m[0]! * lr + m[1]! * lg + m[2]! * lb), toSrgb(m[3]! * lr + m[4]! * lg + m[5]! * lb), toSrgb(m[6]! * lr + m[7]! * lg + m[8]! * lb)];
}

/** Pairs of palette entries that become hard to tell apart under `kind` (ΔE below `threshold`). */
export function confusablePairs(palette: RGB[], kind: Cvd, threshold = 6): [number, number][] {
  const sim = palette.map((c) => simulateCvd(c, kind));
  const out: [number, number][] = [];
  for (let i = 0; i < palette.length; i++)
    for (let j = i + 1; j < palette.length; j++) if (deltaE(palette[i]!, palette[j]!) >= threshold && deltaE(sim[i]!, sim[j]!) < threshold) out.push([i, j]);
  return out;
}

/* --------------------------------------------------------------- built-ins */

export interface BuiltinPalette {
  id: string;
  name: string;
  note: string;
  colours: string[];
}

/** Original LOWPO11Y palettes. Names describe a mood; none is an official hardware palette. */
export const BUILTIN_PALETTES: BuiltinPalette[] = [
  { id: "four-shade", name: "Four-shade handheld", note: "Inspired by early green-screen handhelds", colours: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"] },
  { id: "rust-belt", name: "Rust belt", note: "Corroded steel, oil and hazard paint", colours: ["#1a1414", "#3b2a24", "#5e3a2a", "#8a4b2c", "#b8672e", "#d9944a", "#6b6f6a", "#a3a597", "#d8c46a", "#e8e0c8"] },
  { id: "night-swamp", name: "Night swamp", note: "Murky greens and moonlit fog", colours: ["#0b0f0d", "#16231c", "#22382a", "#2f4f36", "#4a6b3f", "#6f8a4c", "#9aa86a", "#5a6f78", "#8ea3a6", "#c9d3c0"] },
  { id: "phosphor", name: "CRT phosphor", note: "Monitor glow in amber and green", colours: ["#050505", "#1a1306", "#4d3200", "#a86b00", "#ffb000", "#001a0a", "#00661f", "#33ff66", "#e6e6e6"] },
  { id: "dust-road", name: "Dust road", note: "Sun-bleached desert town", colours: ["#2b1d14", "#4f3524", "#7a5236", "#a8774c", "#c99c6b", "#e3c494", "#f2e2c0", "#7f8f9a", "#b6c3c8"] },
  { id: "haunted-hall", name: "Haunted hall", note: "Low-light horror interior", colours: ["#08070a", "#15121a", "#241d2b", "#3a2c3f", "#5a3f4f", "#7a2f2f", "#a14a3a", "#8c8073", "#c9b99a"] },
  { id: "neon-strip", name: "Neon strip", note: "Wet streets and signage", colours: ["#07060d", "#141327", "#24224a", "#3d2d7a", "#ff2e88", "#ff7a3d", "#ffd23f", "#2ee6d6", "#3aa0ff", "#f2f2ff"] },
  { id: "grey-ramp", name: "Grey ramp 8", note: "Even OKLab lightness steps", colours: ["#000000", "#0a0a0a", "#2a2a2a", "#4f4f4f", "#787878", "#a3a3a3", "#d0d0d0", "#ffffff"] },
];
