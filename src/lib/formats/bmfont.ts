/**
 * AngelCode BMFont files: the text format (.fnt) and the JSON shape used by
 * load-bmfont / three-bmfont-text, plus a reference renderer that draws a
 * string from the metadata and page images exactly as a game engine would.
 * Spec: https://www.angelcode.com/products/bmfont/doc/file_format.html
 */
import { createImage, type RGBAImage } from "@/lib/processing/image";

export interface BmChar {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  xoffset: number;
  yoffset: number;
  xadvance: number;
  page: number;
  chnl: number;
}

export interface BmFont {
  info: { face: string; size: number; bold: 0 | 1; italic: 0 | 1; charset: string; unicode: 0 | 1; stretchH: number; smooth: 0 | 1; aa: number; padding: [number, number, number, number]; spacing: [number, number]; outline: number };
  common: { lineHeight: number; base: number; scaleW: number; scaleH: number; pages: number; packed: 0 | 1; alphaChnl: number; redChnl: number; greenChnl: number; blueChnl: number };
  pages: string[];
  chars: BmChar[];
  kernings: { first: number; second: number; amount: number }[];
}

/* ------------------------------------------------------------------- text */

const q = (s: string) => `"${s.replace(/"/g, "'")}"`;

export function toBmfontText(f: BmFont): string {
  const i = f.info,
    c = f.common;
  const lines = [
    `info face=${q(i.face)} size=${i.size} bold=${i.bold} italic=${i.italic} charset=${q(i.charset)} unicode=${i.unicode} stretchH=${i.stretchH} smooth=${i.smooth} aa=${i.aa} padding=${i.padding.join(",")} spacing=${i.spacing.join(",")} outline=${i.outline}`,
    `common lineHeight=${c.lineHeight} base=${c.base} scaleW=${c.scaleW} scaleH=${c.scaleH} pages=${c.pages} packed=${c.packed} alphaChnl=${c.alphaChnl} redChnl=${c.redChnl} greenChnl=${c.greenChnl} blueChnl=${c.blueChnl}`,
    ...f.pages.map((p, n) => `page id=${n} file=${q(p)}`),
    `chars count=${f.chars.length}`,
    ...f.chars.map((ch) => `char id=${ch.id} x=${ch.x} y=${ch.y} width=${ch.width} height=${ch.height} xoffset=${ch.xoffset} yoffset=${ch.yoffset} xadvance=${ch.xadvance} page=${ch.page} chnl=${ch.chnl}`),
  ];
  if (f.kernings.length) lines.push(`kernings count=${f.kernings.length}`, ...f.kernings.map((k) => `kerning first=${k.first} second=${k.second} amount=${k.amount}`));
  return lines.join("\n") + "\n";
}

function fields(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of line.matchAll(/(\w+)=("([^"]*)"|\S+)/g)) out[m[1]!] = m[3] ?? m[2]!;
  return out;
}

export function parseBmfontText(text: string): BmFont {
  const f: BmFont = {
    info: { face: "", size: 0, bold: 0, italic: 0, charset: "", unicode: 1, stretchH: 100, smooth: 1, aa: 1, padding: [0, 0, 0, 0], spacing: [0, 0], outline: 0 },
    common: { lineHeight: 0, base: 0, scaleW: 0, scaleH: 0, pages: 0, packed: 0, alphaChnl: 0, redChnl: 0, greenChnl: 0, blueChnl: 0 },
    pages: [],
    chars: [],
    kernings: [],
  };
  const n = (v: string | undefined) => (v === undefined ? 0 : Number(v));
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const kind = line.split(/\s/, 1)[0];
    const v = fields(line);
    if (kind === "info") {
      f.info = {
        face: v.face ?? "",
        size: n(v.size),
        bold: n(v.bold) ? 1 : 0,
        italic: n(v.italic) ? 1 : 0,
        charset: v.charset ?? "",
        unicode: n(v.unicode) ? 1 : 0,
        stretchH: n(v.stretchH ?? "100"),
        smooth: n(v.smooth) ? 1 : 0,
        aa: n(v.aa),
        padding: (v.padding ?? "0,0,0,0").split(",").map(Number) as BmFont["info"]["padding"],
        spacing: (v.spacing ?? "0,0").split(",").map(Number) as BmFont["info"]["spacing"],
        outline: n(v.outline),
      };
    } else if (kind === "common") {
      f.common = { lineHeight: n(v.lineHeight), base: n(v.base), scaleW: n(v.scaleW), scaleH: n(v.scaleH), pages: n(v.pages), packed: n(v.packed) ? 1 : 0, alphaChnl: n(v.alphaChnl), redChnl: n(v.redChnl), greenChnl: n(v.greenChnl), blueChnl: n(v.blueChnl) };
    } else if (kind === "page") f.pages[n(v.id)] = v.file ?? "";
    else if (kind === "char") f.chars.push({ id: n(v.id), x: n(v.x), y: n(v.y), width: n(v.width), height: n(v.height), xoffset: n(v.xoffset), yoffset: n(v.yoffset), xadvance: n(v.xadvance), page: n(v.page), chnl: n(v.chnl) });
    else if (kind === "kerning") f.kernings.push({ first: n(v.first), second: n(v.second), amount: n(v.amount) });
  }
  if (!f.chars.length || !f.common.lineHeight) throw new Error("Not a BMFont text file (no common line or chars).");
  return f;
}

/* ------------------------------------------------------------------- JSON */

export function toBmfontJson(f: BmFont): string {
  return (
    JSON.stringify(
      {
        pages: f.pages,
        chars: f.chars.map((c, index) => ({ id: c.id, index, char: String.fromCodePoint(c.id), width: c.width, height: c.height, xoffset: c.xoffset, yoffset: c.yoffset, xadvance: c.xadvance, chnl: c.chnl, x: c.x, y: c.y, page: c.page })),
        info: { ...f.info, charset: [...f.info.charset] },
        common: f.common,
        kernings: f.kernings,
      },
      null,
      1,
    ) + "\n"
  );
}

export function parseBmfontJson(text: string): BmFont {
  const v = JSON.parse(text) as Omit<BmFont, "info"> & { info: Omit<BmFont["info"], "charset"> & { charset: string | string[] } };
  if (!Array.isArray(v.chars) || !v.common) throw new Error("Not a BMFont JSON file.");
  return {
    info: { ...v.info, charset: Array.isArray(v.info.charset) ? v.info.charset.join("") : v.info.charset },
    common: v.common,
    pages: v.pages,
    chars: v.chars.map(({ id, x, y, width, height, xoffset, yoffset, xadvance, page, chnl }) => ({ id, x, y, width, height, xoffset, yoffset, xadvance, page, chnl })),
    kernings: v.kernings ?? [],
  };
}

/* --------------------------------------------------------------- renderer */

export interface LaidGlyph {
  id: number;
  /** Glyph box in the output image. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Pen position (left edge of the advance) and line top. */
  penX: number;
  lineY: number;
  advance: number;
}

/**
 * Lays out and draws `text` from BMFont data: pen advances by xadvance plus
 * kerning, glyphs sit at (pen + xoffset, lineTop + yoffset), lines step by
 * lineHeight, "\n" breaks lines. Characters the font lacks use "?" when it
 * exists and are skipped otherwise. Straight-alpha source-over compositing.
 */
export function renderBmfont(font: BmFont, pages: RGBAImage[], text: string): { image: RGBAImage; glyphs: LaidGlyph[]; missing: number[] } {
  const byId = new Map(font.chars.map((c) => [c.id, c]));
  const kern = new Map(font.kernings.map((k) => [`${k.first},${k.second}`, k.amount]));
  const fallback = byId.get(63);
  const laid: LaidGlyph[] = [];
  const missing = new Set<number>();
  let lineY = 0;
  for (const line of text.split("\n")) {
    let pen = 0,
      prev: number | null = null;
    for (const ch of line) {
      const id = ch.codePointAt(0)!;
      let c = byId.get(id);
      if (!c) {
        missing.add(id);
        c = fallback;
        if (!c) continue;
      }
      if (prev !== null) pen += kern.get(`${prev},${c.id}`) ?? 0;
      laid.push({ id: c.id, x: pen + c.xoffset, y: lineY + c.yoffset, w: c.width, h: c.height, penX: pen, lineY, advance: c.xadvance });
      pen += c.xadvance;
      prev = c.id;
    }
    lineY += font.common.lineHeight;
  }
  // image bounds: every advance and every glyph box, from (0, 0)
  let minX = 0,
    minY = 0,
    maxX = 1,
    maxY = Math.max(1, lineY);
  for (const g of laid) {
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.w, g.penX + g.advance);
    maxY = Math.max(maxY, g.y + g.h);
  }
  const img = createImage(maxX - minX, maxY - minY);
  const W = img.width,
    d = img.data;
  for (const g of laid) {
    g.x -= minX;
    g.y -= minY;
    g.penX -= minX;
    g.lineY -= minY;
    const c = byId.get(g.id)!;
    const page = pages[c.page];
    if (!page || !c.width || !c.height) continue;
    for (let y = 0; y < c.height; y++)
      for (let x = 0; x < c.width; x++) {
        const s = ((c.y + y) * page.width + c.x + x) * 4;
        const sa = page.data[s + 3]! / 255;
        if (!sa) continue;
        const o = ((g.y + y) * W + g.x + x) * 4;
        const da = d[o + 3]! / 255;
        const oa = sa + da * (1 - sa);
        for (let k = 0; k < 3; k++) d[o + k] = (page.data[s + k]! * sa + d[o + k]! * da * (1 - sa)) / oa;
        d[o + 3] = oa * 255;
      }
  }
  return { image: img, glyphs: laid, missing: [...missing] };
}
