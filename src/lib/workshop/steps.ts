/**
 * Workshop steps. Each one is a thin, typed wrapper over the same processing
 * core the individual tools use (resample, retro adjust/grain, remap,
 * palette extraction, decal bleed, atlas packing, the Seamless engine), so the
 * Workshop and the tools can't drift apart. Steps never modify their input:
 * cached intermediate images stay valid.
 */
import { z } from "zod";
import { cropImage, trimTransparent } from "@/lib/processing/atlas";
import { bleed } from "@/lib/processing/decal";
import { cloneImage, createImage, hexToRgb, isPowerOfTwo, type RGB, type RGBAImage } from "@/lib/processing/image";
import { BUILTIN_PALETTES, extractPalette } from "@/lib/processing/palette";
import { parsePalette, quantizeChannel } from "@/lib/processing/quantize";
import { remapImage, type DitherMode } from "@/lib/processing/remap";
import { fitTo, longSideSize, resize } from "@/lib/processing/resample";
import { addGrain, adjustColours } from "@/lib/processing/retro";

export type FieldSpec =
  | { key: string; label: string; kind: "number"; min: number; max: number; step?: number; unit?: string; hint?: string; when?: (p: Record<string, unknown>) => boolean }
  | { key: string; label: string; kind: "slider"; min: number; max: number; step?: number; unit?: string; hint?: string; when?: (p: Record<string, unknown>) => boolean }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[]; hint?: string; when?: (p: Record<string, unknown>) => boolean }
  | { key: string; label: string; kind: "toggle"; hint?: string; when?: (p: Record<string, unknown>) => boolean }
  | { key: string; label: string; kind: "colour"; hint?: string; when?: (p: Record<string, unknown>) => boolean }
  | { key: string; label: string; kind: "text"; rows?: number; hint?: string; when?: (p: Record<string, unknown>) => boolean };

/** Runtime capabilities a step may need that plain JS doesn't have (the Seamless engine needs a 2D canvas). */
export interface StepContext {
  seamless?: (img: RGBAImage, settings: Record<string, unknown>) => RGBAImage;
}

export interface StepDef<P> {
  type: string;
  label: string;
  summary: string;
  schema: z.ZodType<P>;
  fields: FieldSpec[];
  /** One line for the step list, e.g. "128×128 crop, smooth". */
  describe: (p: P) => string;
  run: (img: RGBAImage, p: P, ctx: StepContext) => RGBAImage;
}

const int = (min: number, max: number, d: number) => z.number().int().min(min).max(max).catch(d).default(d);
const num = (min: number, max: number, d: number) => z.number().min(min).max(max).catch(d).default(d);
const pick = <T extends string>(values: readonly [T, ...T[]], d: T) => z.enum(values).catch(d).default(d);
const bool = (d: boolean) => z.boolean().catch(d).default(d);
const hex = (d: string) =>
  z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .catch(d)
    .default(d);

const DITHERS = ["none", "bayer2", "bayer4", "bayer8", "blue", "fs"] as const satisfies readonly DitherMode[];
const DITHER_OPTIONS = [
  { value: "none", label: "None" },
  { value: "bayer2", label: "Bayer 2×2" },
  { value: "bayer4", label: "Bayer 4×4" },
  { value: "bayer8", label: "Bayer 8×8" },
  { value: "blue", label: "Blue noise" },
  { value: "fs", label: "Floyd–Steinberg" },
];
const ditherLabel = (d: string) => DITHER_OPTIONS.find((o) => o.value === d)?.label ?? d;

/* ------------------------------------------------------------------ crop */

const cropSchema = z.object({
  mode: pick(["rect", "square", "trim"], "square"),
  x: int(0, 16384, 0),
  y: int(0, 16384, 0),
  width: int(1, 16384, 256),
  height: int(1, 16384, 256),
});

const crop: StepDef<z.infer<typeof cropSchema>> = {
  type: "crop",
  label: "Crop",
  summary: "Centre square, a rectangle, or trim transparent edges.",
  schema: cropSchema,
  fields: [
    {
      key: "mode",
      label: "Crop",
      kind: "select",
      options: [
        { value: "square", label: "Centre square" },
        { value: "rect", label: "Rectangle" },
        { value: "trim", label: "Trim transparent edges" },
      ],
    },
    { key: "x", label: "Left", kind: "number", min: 0, max: 16384, unit: "px", when: (p) => p.mode === "rect" },
    { key: "y", label: "Top", kind: "number", min: 0, max: 16384, unit: "px", when: (p) => p.mode === "rect" },
    { key: "width", label: "Width", kind: "number", min: 1, max: 16384, unit: "px", when: (p) => p.mode === "rect" },
    { key: "height", label: "Height", kind: "number", min: 1, max: 16384, unit: "px", when: (p) => p.mode === "rect" },
  ],
  describe: (p) => (p.mode === "square" ? "centre square" : p.mode === "trim" ? "trim transparent edges" : `${p.width}×${p.height} at ${p.x},${p.y}`),
  run(img, p) {
    if (p.mode === "trim") return trimTransparent(img);
    if (p.mode === "square") {
      const s = Math.min(img.width, img.height);
      return cropImage(img, Math.floor((img.width - s) / 2), Math.floor((img.height - s) / 2), s, s);
    }
    const x = Math.min(p.x, img.width - 1);
    const y = Math.min(p.y, img.height - 1);
    return cropImage(img, x, y, Math.min(p.width, img.width - x), Math.min(p.height, img.height - y));
  },
};

/* ---------------------------------------------------------------- resize */

const resizeSchema = z.object({
  mode: pick(["exact", "long", "scale", "pot"], "exact"),
  width: int(1, 4096, 128),
  height: int(1, 4096, 128),
  scale: num(1, 800, 50),
  fit: pick(["stretch", "crop", "pad"], "crop"),
  sampling: pick(["nearest", "smooth"], "smooth"),
});

const nearestPot = (n: number) => {
  let p = 1;
  while (p * 2 <= n) p *= 2;
  return Math.min(4096, n - p < p * 2 - n ? p : p * 2);
};

export function resizeTarget(w: number, h: number, p: z.infer<typeof resizeSchema>): [number, number] {
  switch (p.mode) {
    case "long":
      return longSideSize(w, h, p.width);
    case "scale":
      return [Math.max(1, Math.min(4096, Math.round((w * p.scale) / 100))), Math.max(1, Math.min(4096, Math.round((h * p.scale) / 100)))];
    case "pot":
      return [nearestPot(w), nearestPot(h)];
    default:
      return [p.width, p.height];
  }
}

const resizeStep: StepDef<z.infer<typeof resizeSchema>> = {
  type: "resize",
  label: "Resize",
  summary: "Exact size, long side, percentage or nearest power of two.",
  schema: resizeSchema,
  fields: [
    {
      key: "mode",
      label: "Size",
      kind: "select",
      options: [
        { value: "exact", label: "Exact width × height" },
        { value: "long", label: "Long side" },
        { value: "scale", label: "Percentage" },
        { value: "pot", label: "Nearest power of two" },
      ],
    },
    { key: "width", label: "Width", kind: "number", min: 1, max: 4096, unit: "px", when: (p) => p.mode === "exact" },
    { key: "width", label: "Long side", kind: "number", min: 1, max: 4096, unit: "px", when: (p) => p.mode === "long" },
    { key: "height", label: "Height", kind: "number", min: 1, max: 4096, unit: "px", when: (p) => p.mode === "exact" },
    { key: "scale", label: "Scale", kind: "number", min: 1, max: 800, unit: "%", when: (p) => p.mode === "scale" },
    {
      key: "fit",
      label: "Fit",
      kind: "select",
      options: [
        { value: "crop", label: "Crop to fill" },
        { value: "pad", label: "Pad to fit" },
        { value: "stretch", label: "Stretch" },
      ],
      when: (p) => p.mode === "exact",
    },
    {
      key: "sampling",
      label: "Sampling",
      kind: "select",
      options: [
        { value: "smooth", label: "Smooth (area average)" },
        { value: "nearest", label: "Nearest (keep pixels)" },
      ],
    },
  ],
  describe: (p) =>
    `${p.mode === "exact" ? `${p.width}×${p.height} ${p.fit}` : p.mode === "long" ? `long side ${p.width}px` : p.mode === "scale" ? `${p.scale}%` : "nearest power of two"}, ${p.sampling}`,
  run(img, p) {
    const [w, h] = resizeTarget(img.width, img.height, p);
    if (w === img.width && h === img.height) return img;
    return p.mode === "exact" ? fitTo(img, w, h, p.fit, p.sampling) : resize(img, w, h, p.sampling);
  },
};

/* -------------------------------------------------------------- seamless */

const seamlessSchema = z.object({
  mode: pick(["blend", "mirror", "edge", "offset"], "blend"),
  direction: pick(["both", "x", "y"], "both"),
  width: int(2, 50, 25),
  strength: int(0, 100, 100),
  falloff: pick(["linear", "smooth", "sharp"], "smooth"),
  jitter: int(0, 100, 0),
  seed: int(1, 99999, 1),
  flatten: int(0, 100, 0),
  pixelSafe: bool(false),
});

const seamless: StepDef<z.infer<typeof seamlessSchema>> = {
  type: "seamless",
  label: "Make seamless",
  summary: "The Seamless tool's tiling: blend, mirror, edge heal or offset.",
  schema: seamlessSchema,
  fields: [
    {
      key: "mode",
      label: "Method",
      kind: "select",
      options: [
        { value: "blend", label: "Offset blend" },
        { value: "mirror", label: "Mirror" },
        { value: "edge", label: "Edge heal" },
        { value: "offset", label: "Offset only (check seams)" },
      ],
    },
    {
      key: "direction",
      label: "Direction",
      kind: "select",
      options: [
        { value: "both", label: "Both" },
        { value: "x", label: "Horizontal" },
        { value: "y", label: "Vertical" },
      ],
    },
    { key: "width", label: "Blend width", kind: "slider", min: 2, max: 50, unit: "%", when: (p) => p.mode === "blend" || p.mode === "edge" },
    { key: "strength", label: "Strength", kind: "slider", min: 0, max: 100, unit: "%", when: (p) => p.mode === "edge" },
    {
      key: "falloff",
      label: "Falloff",
      kind: "select",
      options: [
        { value: "smooth", label: "Smooth" },
        { value: "linear", label: "Linear" },
        { value: "sharp", label: "Sharp" },
      ],
      when: (p) => p.mode === "blend",
    },
    { key: "jitter", label: "Organic seam", kind: "slider", min: 0, max: 100, when: (p) => p.mode === "blend" },
    { key: "seed", label: "Seed", kind: "number", min: 1, max: 99999, when: (p) => p.mode === "blend" && Number(p.jitter) > 0 },
    { key: "flatten", label: "Flatten lighting", kind: "slider", min: 0, max: 100, unit: "%" },
    { key: "pixelSafe", label: "Pixel-safe (dithered blend, no new colours)", kind: "toggle", when: (p) => p.mode === "blend" },
  ],
  describe: (p) => `${p.mode}${p.mode === "blend" || p.mode === "edge" ? ` ${p.width}%` : ""}${p.direction === "both" ? "" : ` ${p.direction}`}`,
  run(img, p, ctx) {
    if (!ctx.seamless) throw new Error("Make seamless needs a browser canvas; it can't run here.");
    return ctx.seamless(img, { ...p, tile: true, size: 0, square: false, psx: false, keyBlack: false });
  },
};

/* ---------------------------------------------------------------- adjust */

const adjustSchema = z.object({
  brightness: int(-100, 100, 0),
  contrast: int(-100, 100, 0),
  saturation: int(-100, 100, 0),
  gamma: num(0.2, 3, 1),
  grain: int(0, 50, 0),
  seed: int(1, 99999, 1),
});

const adjust: StepDef<z.infer<typeof adjustSchema>> = {
  type: "adjust",
  label: "Adjust colour",
  summary: "Brightness, contrast, saturation, gamma and seeded grain.",
  schema: adjustSchema,
  fields: [
    { key: "brightness", label: "Brightness", kind: "slider", min: -100, max: 100 },
    { key: "contrast", label: "Contrast", kind: "slider", min: -100, max: 100 },
    { key: "saturation", label: "Saturation", kind: "slider", min: -100, max: 100 },
    { key: "gamma", label: "Gamma", kind: "slider", min: 0.2, max: 3, step: 0.05 },
    { key: "grain", label: "Grain", kind: "slider", min: 0, max: 50 },
    { key: "seed", label: "Grain seed", kind: "number", min: 1, max: 99999, when: (p) => Number(p.grain) > 0 },
  ],
  describe: (p) =>
    [p.brightness && `brightness ${p.brightness > 0 ? "+" : ""}${p.brightness}`, p.contrast && `contrast ${p.contrast > 0 ? "+" : ""}${p.contrast}`, p.saturation && `saturation ${p.saturation > 0 ? "+" : ""}${p.saturation}`, p.gamma !== 1 && `gamma ${p.gamma}`, p.grain && `grain ${p.grain}`]
      .filter(Boolean)
      .join(", ") || "no change",
  run(img, p) {
    const out = cloneImage(img);
    adjustColours(out, p);
    addGrain(out, p.grain, p.seed);
    return out;
  },
};

/* ---------------------------------------------------------------- alpha */

const alphaSchema = z.object({ threshold: int(1, 255, 128) });

const alpha: StepDef<z.infer<typeof alphaSchema>> = {
  type: "alpha",
  label: "Alpha threshold",
  summary: "Hard cutout: pixels are fully opaque or fully transparent.",
  schema: alphaSchema,
  fields: [{ key: "threshold", label: "Threshold", kind: "slider", min: 1, max: 255, hint: "Pixels at or above this alpha become opaque; the rest transparent." }],
  describe: (p) => `cutout at ${p.threshold}`,
  run(img, p) {
    const out = cloneImage(img);
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3]! >= p.threshold) d[i + 3] = 255;
      else d[i] = d[i + 1] = d[i + 2] = d[i + 3] = 0;
    }
    return out;
  },
};

/* --------------------------------------------------------------- palette */

const paletteSchema = z.object({
  source: pick(["adaptive", "builtin", "custom"], "adaptive"),
  colours: int(2, 256, 16),
  builtin: z.string().max(60).catch(BUILTIN_PALETTES[0]!.id).default(BUILTIN_PALETTES[0]!.id),
  custom: z.string().max(10_000).catch("").default(""),
  dither: pick(DITHERS, "bayer4"),
  strength: int(0, 100, 75),
  wrap: bool(true),
});

export function paletteFor(img: RGBAImage, p: z.infer<typeof paletteSchema>): RGB[] {
  if (p.source === "builtin") return (BUILTIN_PALETTES.find((b) => b.id === p.builtin) ?? BUILTIN_PALETTES[0]!).colours.map((c) => hexToRgb(c));
  if (p.source === "custom") return parsePalette(p.custom).slice(0, 256);
  return extractPalette(img, { count: p.colours, iterations: 4 });
}

const palette: StepDef<z.infer<typeof paletteSchema>> = {
  type: "palette",
  label: "Palette",
  summary: "Map colours to an extracted, starter or custom palette, with optional dithering.",
  schema: paletteSchema,
  fields: [
    {
      key: "source",
      label: "Palette",
      kind: "select",
      options: [
        { value: "adaptive", label: "Extract from image" },
        { value: "builtin", label: "Starter palette" },
        { value: "custom", label: "Custom colours" },
      ],
    },
    { key: "colours", label: "Colours", kind: "slider", min: 2, max: 256, when: (p) => p.source === "adaptive" },
    { key: "builtin", label: "Starter palette", kind: "select", options: BUILTIN_PALETTES.map((b) => ({ value: b.id, label: `${b.name} (${b.colours.length})` })), when: (p) => p.source === "builtin" },
    { key: "custom", label: "Colours", kind: "text", rows: 3, hint: "Hex colours, separated by spaces, commas or new lines.", when: (p) => p.source === "custom" },
    { key: "dither", label: "Dither", kind: "select", options: DITHER_OPTIONS },
    { key: "strength", label: "Dither strength", kind: "slider", min: 0, max: 100, unit: "%", when: (p) => p.dither !== "none" },
    { key: "wrap", label: "Wrap error diffusion (keeps tiles seamless)", kind: "toggle", when: (p) => p.dither === "fs" },
  ],
  describe: (p) =>
    `${p.source === "adaptive" ? `${p.colours} colours from image` : p.source === "builtin" ? (BUILTIN_PALETTES.find((b) => b.id === p.builtin)?.name ?? p.builtin) : "custom colours"}${p.dither === "none" ? "" : `, ${ditherLabel(p.dither)} ${p.strength}%`}`,
  run(img, p) {
    const colours = paletteFor(img, p);
    if (!colours.length) return img;
    const out = cloneImage(img);
    remapImage(out, { palette: colours, dither: p.dither, strength: p.strength / 100, wrap: p.wrap });
    return out;
  },
};

/* ---------------------------------------------------------------- dither */

const ditherSchema = z.object({
  r: int(1, 8, 5),
  g: int(1, 8, 5),
  b: int(1, 8, 5),
  dither: pick(DITHERS, "bayer4"),
  strength: int(0, 100, 75),
  wrap: bool(true),
});

const dither: StepDef<z.infer<typeof ditherSchema>> = {
  type: "dither",
  label: "Bit depth & dither",
  summary: "Reduce each channel to a bit depth (5-5-5 is the PlayStation's 15-bit colour).",
  schema: ditherSchema,
  fields: [
    { key: "r", label: "Red bits", kind: "slider", min: 1, max: 8 },
    { key: "g", label: "Green bits", kind: "slider", min: 1, max: 8 },
    { key: "b", label: "Blue bits", kind: "slider", min: 1, max: 8 },
    { key: "dither", label: "Dither", kind: "select", options: DITHER_OPTIONS },
    { key: "strength", label: "Dither strength", kind: "slider", min: 0, max: 100, unit: "%", when: (p) => p.dither !== "none" },
    { key: "wrap", label: "Wrap error diffusion (keeps tiles seamless)", kind: "toggle", when: (p) => p.dither === "fs" },
  ],
  describe: (p) => `${p.r}-${p.g}-${p.b} bits${p.dither === "none" ? "" : `, ${ditherLabel(p.dither)} ${p.strength}%`}`,
  run(img, p) {
    const out = cloneImage(img);
    remapImage(out, { palette: [], bits: { r: p.r, g: p.g, b: p.b }, dither: p.dither, strength: p.strength / 100, wrap: p.wrap });
    return out;
  },
};

/* ------------------------------------------------------------------ edge */

const edgeSchema = z.object({
  padding: int(0, 256, 0),
  fill: pick(["transparent", "extend", "wrap", "colour"], "transparent"),
  colour: hex("#000000"),
  pot: bool(false),
  bleed: bool(false),
});

function padImage(img: RGBAImage, left: number, top: number, w: number, h: number, fill: string, colour: RGB): RGBAImage {
  const out = createImage(w, h, fill === "colour" ? [colour[0], colour[1], colour[2], 255] : [0, 0, 0, 0]);
  const sw = img.width,
    sh = img.height;
  for (let y = 0; y < h; y++) {
    let sy = y - top;
    const inY = sy >= 0 && sy < sh;
    if (!inY) {
      if (fill === "extend") sy = Math.min(sh - 1, Math.max(0, sy));
      else if (fill === "wrap") sy = ((sy % sh) + sh) % sh;
      else continue;
    }
    for (let x = 0; x < w; x++) {
      let sx = x - left;
      const inX = sx >= 0 && sx < sw;
      if (!inX) {
        if (fill === "extend") sx = Math.min(sw - 1, Math.max(0, sx));
        else if (fill === "wrap") sx = ((sx % sw) + sw) % sw;
        else continue;
      }
      const si = (sy * sw + sx) * 4,
        di = (y * w + x) * 4;
      out.data[di] = img.data[si]!;
      out.data[di + 1] = img.data[si + 1]!;
      out.data[di + 2] = img.data[si + 2]!;
      out.data[di + 3] = img.data[si + 3]!;
    }
  }
  return out;
}

const nextPot = (n: number) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

const edge: StepDef<z.infer<typeof edgeSchema>> = {
  type: "edge",
  label: "Edge & padding",
  summary: "Add a border (transparent, extended, wrapped or a colour), pad up to a power of two, bleed colour into transparent pixels.",
  schema: edgeSchema,
  fields: [
    { key: "padding", label: "Padding", kind: "number", min: 0, max: 256, unit: "px" },
    {
      key: "fill",
      label: "Fill",
      kind: "select",
      options: [
        { value: "transparent", label: "Transparent" },
        { value: "extend", label: "Extend edge pixels" },
        { value: "wrap", label: "Wrap around (tiles)" },
        { value: "colour", label: "Colour" },
      ],
    },
    { key: "colour", label: "Colour", kind: "colour", when: (p) => p.fill === "colour" },
    { key: "pot", label: "Pad up to a power of two", kind: "toggle", hint: "Centres the image on the next power-of-two canvas." },
    { key: "bleed", label: "Bleed colour into transparent pixels", kind: "toggle", hint: "Stops dark fringes when textures are filtered or mipmapped." },
  ],
  describe: (p) => [p.padding && `${p.padding}px ${p.fill}`, p.pot && "pad to power of two", p.bleed && "colour bleed"].filter(Boolean).join(", ") || "no change",
  run(img, p) {
    let out = img;
    if (p.padding > 0) out = padImage(out, p.padding, p.padding, out.width + p.padding * 2, out.height + p.padding * 2, p.fill, hexToRgb(p.colour));
    if (p.pot && (!isPowerOfTwo(out.width) || !isPowerOfTwo(out.height))) {
      const w = Math.min(8192, nextPot(out.width)),
        h = Math.min(8192, nextPot(out.height));
      out = padImage(out, Math.floor((w - out.width) / 2), Math.floor((h - out.height) / 2), w, h, p.fill, hexToRgb(p.colour));
    }
    if (p.bleed) {
      if (out === img) out = cloneImage(img);
      bleed(out);
    }
    return out;
  },
};

export const STEPS = { crop, resize: resizeStep, seamless, adjust, alpha, palette, dither, edge } as const;
export type StepType = keyof typeof STEPS | "atlas";
export const STEP_TYPES = Object.keys(STEPS) as (keyof typeof STEPS)[];

/** The 5-5-5 snap used for "PlayStation 15-bit" descriptions elsewhere. */
export const snap555 = (c: RGB): RGB => [quantizeChannel(c[0], 5), quantizeChannel(c[1], 5), quantizeChannel(c[2], 5)];
