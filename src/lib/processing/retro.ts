/**
 * Retro / PSX-style texture conversion (tool T02): exact output size,
 * colour adjustments, optional seeded grain, channel bit depth, adaptive or
 * locked palettes and dithering, with alpha preserved or cut to 1 bit.
 *
 * These are visual effects. Reducing colours here does not by itself make a
 * texture fit any console's VRAM or CLUT rules.
 */
import { cloneImage, type RGB, type RGBAImage } from "./image";
import { countColours, medianCut, quantizeChannel } from "./quantize";
import { hash2 } from "./random";
import { remapImage, type DitherMode } from "./remap";
import { fitTo, longSideSize, type Fit, type Sampling } from "./resample";

export type { DitherMode };

export interface RetroSettings {
  /** "long" keeps aspect with the long side = width; "exact" is width×height with `fit`. */
  sizeMode: "long" | "exact";
  width: number;
  height: number;
  fit: Fit;
  sampling: Sampling;
  brightness: number; // -100..100
  contrast: number; // -100..100
  saturation: number; // -100..100
  gamma: number; // 0.2..3, 1 = unchanged
  grain: number; // 0..50, in 8-bit levels
  seed: number;
  /** Per-channel bit depth before palette matching (8 = unchanged). */
  bits: { r: number; g: number; b: number };
  palette: "off" | "adaptive" | "locked";
  colours: number; // adaptive palette size 2..256
  locked: RGB[];
  dither: DitherMode;
  ditherStrength: number; // 0..100
  /** Floyd–Steinberg errors wrap left↔right so tileable textures stay tileable. */
  wrap: boolean;
  alpha: "keep" | "cutout";
  alphaThreshold: number; // 1..255 for cutout
}

export const RETRO_DEFAULTS: RetroSettings = {
  sizeMode: "exact",
  width: 128,
  height: 128,
  fit: "crop",
  sampling: "smooth",
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 1,
  grain: 0,
  seed: 1,
  bits: { r: 5, g: 5, b: 5 },
  palette: "adaptive",
  colours: 16,
  locked: [],
  dither: "bayer4",
  ditherStrength: 75,
  wrap: true,
  alpha: "keep",
  alphaThreshold: 128,
};

export interface RetroResult {
  /** Resized only: the before image at output size. */
  base: RGBAImage;
  image: RGBAImage;
  palette: RGB[];
  colours: number;
  transparent: boolean;
}

export function outputSize(srcW: number, srcH: number, s: Pick<RetroSettings, "sizeMode" | "width" | "height">): [number, number] {
  return s.sizeMode === "long" ? longSideSize(srcW, srcH, s.width) : [s.width, s.height];
}

/** Brightness, contrast, saturation and gamma, in place. Shared with the Workshop. */
export function adjustColours(img: RGBAImage, s: Pick<RetroSettings, "brightness" | "contrast" | "saturation" | "gamma">) {
  const { brightness, contrast, saturation, gamma } = s;
  if (!brightness && !contrast && !saturation && gamma === 1) return;
  const b = brightness * 2.55;
  const c = contrast >= 0 ? 1 + contrast / 50 : 1 + contrast / 100; // 0..3
  const sat = 1 + saturation / 100;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) {
    let x = (v - 128) * c + 128 + b;
    x = 255 * Math.pow(Math.min(1, Math.max(0, x / 255)), 1 / gamma);
    lut[v] = x;
  }
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = lut[d[i]!]!,
      g = lut[d[i + 1]!]!,
      bl = lut[d[i + 2]!]!;
    if (sat !== 1) {
      const l = 0.299 * r + 0.587 * g + 0.114 * bl;
      r = l + (r - l) * sat;
      g = l + (g - l) * sat;
      bl = l + (bl - l) * sat;
    }
    d[i] = r;
    d[i + 1] = g;
    d[i + 2] = bl;
  }
}

/** Seeded monochrome grain in 8-bit levels, in place. Shared with the Workshop. */
export function addGrain(img: RGBAImage, amount: number, seed: number) {
  if (amount <= 0) return;
  const d = img.data,
    w = img.width;
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const n = (hash2(p % w, (p / w) | 0, seed) - 0.5) * 2 * amount;
    d[i] = d[i]! + n;
    d[i + 1] = d[i + 1]! + n;
    d[i + 2] = d[i + 2]! + n;
  }
}

export function convertRetro(src: RGBAImage, settings: Partial<RetroSettings> = {}): RetroResult {
  const s: RetroSettings = { ...RETRO_DEFAULTS, ...settings, bits: { ...RETRO_DEFAULTS.bits, ...settings.bits } };
  const [w, h] = outputSize(src.width, src.height, s);
  const base = fitTo(src, w, h, s.fit, s.sampling);
  const img = cloneImage(base);
  const d = img.data;

  if (s.alpha === "cutout") for (let i = 3; i < d.length; i += 4) d[i] = d[i]! >= s.alphaThreshold ? 255 : 0;
  adjustColours(img, s);
  addGrain(img, s.grain, s.seed);

  const bitsOn = s.bits.r < 8 || s.bits.g < 8 || s.bits.b < 8;
  const snap = (c: RGB): RGB => [quantizeChannel(c[0], s.bits.r), quantizeChannel(c[1], s.bits.g), quantizeChannel(c[2], s.bits.b)];
  let palette: RGB[] = [];
  if (s.palette === "adaptive") palette = medianCut(img, Math.max(2, Math.min(256, s.colours | 0)), bitsOn ? snap : undefined);
  else if (s.palette === "locked" && s.locked.length) palette = bitsOn ? s.locked.map(snap) : s.locked.map((c) => [...c] as RGB);
  if (palette.length || bitsOn) remapImage(img, { palette, bits: s.bits, dither: s.dither, strength: s.ditherStrength / 100, wrap: s.wrap });
  // fully transparent pixels carry no colour: zero them so PNGs compress and stay clean
  let transparent = false;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3]! < 255) transparent = true;
    if (d[i + 3] === 0) d[i] = d[i + 1] = d[i + 2] = 0;
  }
  return { base, image: img, palette, colours: countColours(img), transparent };
}

export interface RetroPreset {
  id: string;
  label: string;
  description: string;
  settings: Partial<RetroSettings>;
}

/** Starting points, named for the look they imitate. None of them guarantees hardware limits. */
export const RETRO_PRESETS: RetroPreset[] = [
  {
    id: "psx-4bit",
    label: "PS1-style 16 colours",
    description: "15-bit colour, 16-colour adaptive palette, 4×4 ordered dither — the look of a 4-bit CLUT texture.",
    settings: { bits: { r: 5, g: 5, b: 5 }, palette: "adaptive", colours: 16, dither: "bayer4", ditherStrength: 75, sampling: "smooth" },
  },
  {
    id: "psx-8bit",
    label: "PS1-style 256 colours",
    description: "15-bit colour, 256-colour adaptive palette, light ordered dither.",
    settings: { bits: { r: 5, g: 5, b: 5 }, palette: "adaptive", colours: 256, dither: "bayer4", ditherStrength: 40, sampling: "smooth" },
  },
  {
    id: "n64-ish",
    label: "N64-style soft 16-bit",
    description: "RGB555 without a palette and no dither, smooth resampling: soft and banded.",
    settings: { bits: { r: 5, g: 5, b: 5 }, palette: "off", dither: "none", sampling: "smooth" },
  },
  {
    id: "crunchy",
    label: "Crunchy 8 colours",
    description: "8-colour palette, blue-noise dither, nearest sampling, a touch of grain.",
    settings: { bits: { r: 8, g: 8, b: 8 }, palette: "adaptive", colours: 8, dither: "blue", ditherStrength: 90, sampling: "nearest", grain: 6 },
  },
  {
    id: "four-shade",
    label: "Four-shade handheld (inspired)",
    description: "Four greens in the spirit of early handhelds. Not an official palette.",
    settings: {
      bits: { r: 8, g: 8, b: 8 },
      palette: "locked",
      locked: [
        [15, 56, 15],
        [48, 98, 48],
        [139, 172, 15],
        [155, 188, 15],
      ],
      dither: "bayer4",
      ditherStrength: 80,
      saturation: -100,
      contrast: 20,
    },
  },
];
