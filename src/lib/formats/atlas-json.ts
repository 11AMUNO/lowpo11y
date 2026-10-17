/**
 * Atlas metadata: LOWPO11Y JSON and CSV, UV maths for both origin
 * conventions, and a validator that checks an atlas image against its JSON
 * (used by tests, and usable by anyone checking an export).
 */
import type { RGBAImage } from "@/lib/processing/image";
import { rotate } from "@/lib/processing/atlas";

export type UvOrigin = "top-left" | "bottom-left";

export interface AtlasFrame {
  name: string;
  /** Content rectangle in pixels from the image's top-left corner (extrusion not included). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Stored turned 90° clockwise; `w`/`h` are the stored (turned) size. */
  rotated: boolean;
  /** Size of the tile before rotation. */
  sourceW: number;
  sourceH: number;
}

export interface Uv {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface AtlasDoc {
  format: "lowpo11y-atlas";
  version: 1;
  image: string;
  width: number;
  height: number;
  /** Where UV (0,0) is: "top-left" (Godot, image space) or "bottom-left" (Blender, Unity, OpenGL). */
  uvOrigin: UvOrigin;
  /** Pixels the UV box is pulled in from each edge (0.5 = texel centres). */
  uvInset: number;
  padding: number;
  extrude: number;
  frames: (AtlasFrame & { uv: Uv })[];
}

const round = (n: number) => Math.round(n * 1e8) / 1e8;

/** UV box of a frame. (u0, v0) is the corner nearest the UV origin. */
export function frameUv(f: Pick<AtlasFrame, "x" | "y" | "w" | "h">, width: number, height: number, origin: UvOrigin, inset = 0): Uv {
  const x0 = (f.x + inset) / width,
    x1 = (f.x + f.w - inset) / width;
  const top = (f.y + inset) / height,
    bottom = (f.y + f.h - inset) / height;
  return origin === "top-left" ? { u0: round(x0), v0: round(top), u1: round(x1), v1: round(bottom) } : { u0: round(x0), v0: round(1 - bottom), u1: round(x1), v1: round(1 - top) };
}

export function buildAtlasDoc(o: Omit<AtlasDoc, "format" | "version" | "frames"> & { frames: AtlasFrame[] }): AtlasDoc {
  return {
    format: "lowpo11y-atlas",
    version: 1,
    image: o.image,
    width: o.width,
    height: o.height,
    uvOrigin: o.uvOrigin,
    uvInset: o.uvInset,
    padding: o.padding,
    extrude: o.extrude,
    frames: o.frames.map((f) => ({ ...f, uv: frameUv(f, o.width, o.height, o.uvOrigin, o.uvInset) })),
  };
}

export const toAtlasJson = (doc: AtlasDoc) => JSON.stringify(doc, null, 2) + "\n";

const csvCell = (v: string | number | boolean) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toAtlasCsv(doc: AtlasDoc): string {
  const head = ["name", "x", "y", "w", "h", "rotated", "source_w", "source_h", "u0", "v0", "u1", "v1"];
  const rows = doc.frames.map((f) => [f.name, f.x, f.y, f.w, f.h, f.rotated, f.sourceW, f.sourceH, f.uv.u0, f.uv.v0, f.uv.u1, f.uv.v1].map(csvCell).join(","));
  return [head.join(","), ...rows].join("\n") + "\n";
}

export function parseAtlasJson(text: string): AtlasDoc {
  const v = JSON.parse(text) as Partial<AtlasDoc>;
  if (v.format !== "lowpo11y-atlas" || v.version !== 1 || !Array.isArray(v.frames)) throw new Error("Not a LOWPO11Y atlas JSON file.");
  return v as AtlasDoc;
}

/**
 * Checks an atlas against its JSON: frames inside the image, extruded
 * frames never overlapping, UVs matching the pixel rects, and (when the
 * source tiles are given, by frame name) the pixels inside each rect being
 * exactly the tile, turned if `rotated`. Returns a list of problems.
 */
export function validateAtlas(doc: AtlasDoc, atlas: RGBAImage, tiles?: Map<string, RGBAImage>): string[] {
  const problems: string[] = [];
  const e = doc.extrude;
  if (atlas.width !== doc.width || atlas.height !== doc.height) problems.push(`image is ${atlas.width}×${atlas.height}, JSON says ${doc.width}×${doc.height}`);
  doc.frames.forEach((f, i) => {
    if (f.x - e < 0 || f.y - e < 0 || f.x + f.w + e > doc.width || f.y + f.h + e > doc.height) problems.push(`${f.name}: outside the image`);
    if ((f.rotated ? [f.h, f.w] : [f.w, f.h]).join() !== [f.sourceW, f.sourceH].join()) problems.push(`${f.name}: rect size doesn't match source size`);
    const want = frameUv(f, doc.width, doc.height, doc.uvOrigin, doc.uvInset);
    for (const k of ["u0", "v0", "u1", "v1"] as const) if (Math.abs(want[k] - f.uv[k]) > 1e-7) problems.push(`${f.name}: ${k} is ${f.uv[k]}, expected ${want[k]}`);
    for (let j = 0; j < i; j++) {
      const g = doc.frames[j]!;
      if (f.x - e < g.x + g.w + e && g.x - e < f.x + f.w + e && f.y - e < g.y + g.h + e && g.y - e < f.y + f.h + e) problems.push(`${f.name} overlaps ${g.name}`);
    }
    const tile = tiles?.get(f.name);
    if (tile) {
      const t = f.rotated ? rotate(tile, 90) : tile;
      if (t.width !== f.w || t.height !== f.h) problems.push(`${f.name}: tile is ${t.width}×${t.height}, rect is ${f.w}×${f.h}`);
      else {
        let bad = 0;
        for (let y = 0; y < f.h && !bad; y++)
          for (let x = 0; x < f.w; x++) {
            const a = ((f.y + y) * atlas.width + f.x + x) * 4,
              b = (y * t.width + x) * 4;
            if (atlas.data[a] !== t.data[b] || atlas.data[a + 1] !== t.data[b + 1] || atlas.data[a + 2] !== t.data[b + 2] || atlas.data[a + 3] !== t.data[b + 3]) {
              bad++;
              break;
            }
          }
        if (bad) problems.push(`${f.name}: pixels inside the rect differ from the tile`);
      }
    }
  });
  return problems;
}

/** Engine presets: where UV (0,0) is in each tool. */
export const UV_PRESETS: { id: string; label: string; origin: UvOrigin; note: string }[] = [
  { id: "blender", label: "Blender", origin: "bottom-left", note: "Blender's UV editor puts (0,0) at the bottom-left of the image." },
  { id: "godot", label: "Godot", origin: "top-left", note: "Godot UVs start at the top-left, like image pixels." },
  { id: "unity", label: "Unity", origin: "bottom-left", note: "Unity UVs start at the bottom-left (OpenGL convention)." },
  { id: "pixels", label: "Image", origin: "top-left", note: "Same direction as pixel rects: y grows downwards." },
];
