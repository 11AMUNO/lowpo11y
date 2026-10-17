/**
 * Palette files: GIMP `.gpl`, plain `.hex` (one rrggbb per line, the Lospec
 * format), LOWPO11Y JSON and PNG swatches. Each reader accepts what its
 * writer produces, exactly.
 */
import { createImage, hexToRgb, rgbToHex, type RGB, type RGBAImage } from "@/lib/processing/image";

export interface PaletteColour {
  rgb: RGB;
  name?: string;
  locked?: boolean;
}

export interface PaletteDoc {
  name: string;
  colours: PaletteColour[];
}

export const MAX_COLOURS = 256;

const clean = (s: string) => s.replace(/[\r\n\t]+/g, " ").trim();

function dedupe(colours: PaletteColour[]): PaletteColour[] {
  const seen = new Set<string>();
  return colours.filter((c) => (seen.has(c.rgb.join()) ? false : (seen.add(c.rgb.join()), true))).slice(0, MAX_COLOURS);
}

/* -------------------------------------------------------------------- GPL */

export function toGpl(doc: PaletteDoc): string {
  const lines = ["GIMP Palette", `Name: ${clean(doc.name) || "Untitled"}`, `Columns: ${Math.min(16, Math.max(1, doc.colours.length))}`, "#"];
  for (const c of doc.colours) {
    const [r, g, b] = c.rgb;
    lines.push(`${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${clean(c.name ?? "") || rgbToHex(c.rgb)}`);
  }
  return lines.join("\n") + "\n";
}

export function fromGpl(text: string): PaletteDoc {
  const lines = text.split(/\r?\n/);
  if (!/^GIMP Palette\s*$/.test(lines[0]?.trim() ?? "")) throw new Error("Not a GIMP palette: the first line must be “GIMP Palette”.");
  let name = "";
  const colours: PaletteColour[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const meta = /^(Name|Columns):\s*(.*)$/i.exec(line);
    if (meta) {
      if (meta[1]!.toLowerCase() === "name") name = meta[2]!.trim();
      continue;
    }
    const m = /^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})(?:\s+(.*))?$/.exec(line);
    if (!m) continue;
    const rgb = [Number(m[1]), Number(m[2]), Number(m[3])] as RGB;
    if (rgb.some((v) => v > 255)) continue;
    const label = m[4]?.trim();
    colours.push({ rgb, name: label && label.toLowerCase() !== rgbToHex(rgb) && label.toLowerCase() !== "untitled" ? label : undefined });
  }
  return { name, colours: dedupe(colours) };
}

/* -------------------------------------------------------------------- HEX */

export const toHex = (doc: PaletteDoc) => doc.colours.map((c) => rgbToHex(c.rgb).slice(1)).join("\n") + "\n";

export function fromHex(text: string): PaletteDoc {
  const colours: PaletteColour[] = [];
  for (const m of text.matchAll(/(?:^|[\s,;#])([0-9a-f]{6})(?![0-9a-f])/gim)) colours.push({ rgb: hexToRgb(m[1]!) });
  return { name: "", colours: dedupe(colours) };
}

/* ------------------------------------------------------------------- JSON */

export const JSON_FORMAT = "lowpo11y-palette";

export function toJson(doc: PaletteDoc): string {
  return (
    JSON.stringify(
      {
        format: JSON_FORMAT,
        version: 1,
        name: doc.name,
        colours: doc.colours.map((c) => ({ hex: rgbToHex(c.rgb), rgb: c.rgb, ...(c.name ? { name: c.name } : {}), ...(c.locked ? { locked: true } : {}) })),
      },
      null,
      2,
    ) + "\n"
  );
}

export function fromJson(text: string): PaletteDoc {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error("This JSON file can't be parsed.");
  }
  const o = v as { format?: unknown; name?: unknown; colours?: unknown };
  // also accept a bare array of hex strings
  const list = Array.isArray(v) ? v : Array.isArray(o.colours) ? o.colours : null;
  if (!list) throw new Error("No colours found: expected a LOWPO11Y palette or an array of hex colours.");
  const colours: PaletteColour[] = [];
  for (const item of list) {
    const hex = typeof item === "string" ? item : (item as { hex?: unknown })?.hex;
    if (typeof hex !== "string" || !/^#?[0-9a-f]{6}$/i.test(hex.trim())) continue;
    const it = item as { name?: unknown; locked?: unknown };
    colours.push({ rgb: hexToRgb(hex.trim()), name: typeof it.name === "string" && it.name.trim() ? it.name.trim() : undefined, locked: it.locked === true || undefined });
  }
  if (!colours.length) throw new Error("No valid #rrggbb colours in this file.");
  return { name: typeof o.name === "string" ? o.name : "", colours: dedupe(colours) };
}

/* ---------------------------------------------------------------- swatches */

/** Swatch image: `cell`×`cell` squares, `columns` per row (default: all in one row). */
export function toSwatchImage(colours: RGB[], cell = 1, columns = colours.length): RGBAImage {
  const cols = Math.max(1, Math.min(columns, colours.length));
  const rows = Math.max(1, Math.ceil(colours.length / cols));
  const img = createImage(cols * cell, rows * cell);
  colours.forEach((c, i) => {
    const x0 = (i % cols) * cell,
      y0 = Math.floor(i / cols) * cell;
    for (let y = y0; y < y0 + cell; y++)
      for (let x = x0; x < x0 + cell; x++) img.data.set([c[0], c[1], c[2], 255], (y * img.width + x) * 4);
  });
  return img;
}

/** Distinct opaque colours of an image in reading order (left→right, top→bottom), up to 256. */
export function fromSwatchImage(img: RGBAImage): RGB[] {
  const out: RGB[] = [];
  const seen = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length && out.length < MAX_COLOURS; i += 4) {
    if (d[i + 3]! < 255) continue;
    const k = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push([d[i]!, d[i + 1]!, d[i + 2]!]);
  }
  return out;
}

/* ------------------------------------------------------------ any text file */

/** Reads a palette from text by content: GPL, LOWPO11Y/array JSON, or hex values. */
export function parsePaletteText(text: string): PaletteDoc {
  const t = text.trim();
  if (/^GIMP Palette/.test(t)) return fromGpl(t);
  if (t.startsWith("{") || t.startsWith("[")) return fromJson(t);
  const doc = fromHex(t);
  if (!doc.colours.length) throw new Error("No colours found. Use a GIMP .gpl, a .hex list, LOWPO11Y JSON or #rrggbb values.");
  return doc;
}
