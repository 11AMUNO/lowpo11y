import type { PaletteColour, PaletteDoc } from "@/lib/formats/palette-files";
import type { RGB } from "@/lib/processing/image";
import type { Cvd } from "@/lib/processing/palette";
import type { DitherMode } from "@/lib/processing/remap";

export interface Swatch extends PaletteColour {
  id: number;
}

export interface Doc {
  name: string;
  colours: Swatch[];
}

export interface Settings {
  count: number;
  dither: DitherMode;
  strength: number;
  cvd: Cvd | "none";
  cell: 1 | 8 | 32;
}

export const COUNTS = [4, 8, 16, 32, 64, 128, 256];
export const DEFAULT_SETTINGS: Settings = { count: 16, dither: "none", strength: 80, cvd: "none", cell: 8 };
export const EMPTY_DOC: Doc = { name: "", colours: [] };
export const DOC_KEY = "lp-palette-doc";
export const SETTINGS_KEY = "lp-palette-settings";

let nextId = 1;
export const swatch = (rgb: RGB, extra: Partial<PaletteColour> = {}): Swatch => ({ id: nextId++, rgb, ...extra });

export const fromPaletteDoc = (d: PaletteDoc): Doc => ({ name: d.name, colours: d.colours.map((c) => swatch(c.rgb, { name: c.name, locked: c.locked })) });
export const toPaletteDoc = (d: Doc): PaletteDoc => ({ name: d.name, colours: d.colours.map(({ rgb, name, locked }) => ({ rgb, name, locked })) });

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode: not remembered
  }
}

/** Filename-safe version of a palette name. */
export const fileBase = (name: string) => (name.trim() || "palette").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").replace(/\s+/g, "-").toLowerCase();
