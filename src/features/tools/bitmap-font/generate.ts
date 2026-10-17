/**
 * Rasterises a font into BMFont pages with the browser's own text renderer.
 * Main thread only: it draws with a FontFace registered in document.fonts.
 */
import type { BmChar, BmFont } from "@/lib/formats/bmfont";
import type { FontInfo } from "@/lib/fonts/sfnt";
import { compose, cropImage, opaqueBounds, pack, PACK_DEFAULTS } from "@/lib/processing/atlas";
import { createImage, hexToRgb, type RGBAImage } from "@/lib/processing/image";

export interface GenSettings {
  size: number;
  render: "smooth" | "pixel";
  /** Pixel mode: alpha at or above this becomes solid. */
  threshold: number;
  color: string;
  outline: number;
  outlineColor: string;
  shadow: boolean;
  shadowX: number;
  shadowY: number;
  shadowColor: string;
  /** Extra advance per glyph, in pixels. */
  spacing: number;
  /** Line height as a percentage of the font's own. */
  lineHeight: number;
  /** Transparent pixels between glyphs on a page. */
  padding: number;
  /** Square page size; 0 = smallest power of two that fits. */
  page: number;
  kerning: boolean;
}

export const GEN_DEFAULTS: GenSettings = { size: 20, render: "pixel", threshold: 128, color: "#ffffff", outline: 0, outlineColor: "#000000", shadow: false, shadowX: 1, shadowY: 1, shadowColor: "#000000", spacing: 0, lineHeight: 100, padding: 1, page: 0, kerning: true };

export interface GenResult {
  font: BmFont;
  pages: RGBAImage[];
  /** Requested code points the font doesn't have. */
  missing: number[];
  ms: number;
}

const KERNING_LIMIT = 256;

/** Alpha channel of a canvas as a 0..255 mask, optionally hard-thresholded. */
function alphaOf(ctx: CanvasRenderingContext2D, w: number, h: number, threshold?: number): Uint8Array {
  const d = ctx.getImageData(0, 0, w, h).data;
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = threshold === undefined ? d[i * 4 + 3]! : d[i * 4 + 3]! >= threshold ? 255 : 0;
  return m;
}

/** Square dilation of a 1-bit mask by r pixels. */
function dilate(m: Uint8Array, w: number, h: number, r: number): Uint8Array {
  if (r <= 0) return m;
  const out = new Uint8Array(m.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!m[y * w + x]) continue;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx;
          if (xx >= 0 && xx < w) out[yy * w + xx] = 255;
        }
      }
    }
  return out;
}

export function generate(family: string, info: FontInfo, codepoints: number[], s: GenSettings, name: string): GenResult {
  const t0 = performance.now();
  const scale = s.size / info.unitsPerEm;
  const asc = info.ascender * scale,
    desc = -info.descender * scale,
    gap = Math.max(0, info.lineGap) * scale;
  const base = Math.round(asc);
  const lineHeight = Math.max(1, Math.round(((asc + desc + gap) * s.lineHeight) / 100));
  const fx = Math.max(s.outline, s.shadow ? Math.max(Math.abs(s.shadowX), Math.abs(s.shadowY)) + s.outline : 0);
  const margin = Math.ceil(s.size * 0.75) + fx + 2;
  const W = Math.ceil(s.size * 2.5) + margin * 2,
    H = Math.ceil(asc + desc) + margin * 2;
  const penX = margin,
    penY = margin + Math.ceil(asc);

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const fontCss = `${s.size}px "${family}"`;
  ctx.font = fontCss;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  (ctx as CanvasRenderingContext2D & { fontKerning?: string }).fontKerning = "normal";

  const present = codepoints.filter((c) => info.cmap.has(c));
  const missing = codepoints.filter((c) => !info.cmap.has(c));
  const fill = hexToRgb(s.color),
    line = hexToRgb(s.outlineColor),
    shade = hexToRgb(s.shadowColor);

  const glyphs: { id: number; img: RGBAImage | null; xoffset: number; yoffset: number; xadvance: number }[] = [];
  for (const id of present) {
    const ch = String.fromCodePoint(id);
    const adv = Math.round(ctx.measureText(ch).width) + s.spacing;
    const full = createImage(W, H);
    if (s.render === "pixel") {
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = "#fff";
      ctx.fillText(ch, penX, penY);
      const body = alphaOf(ctx, W, H, s.threshold);
      const ring = dilate(body, W, H, s.outline);
      for (let i = 0; i < body.length; i++) {
        const x = i % W,
          y = (i / W) | 0;
        let c: [number, number, number] | null = null;
        if (body[i]) c = fill;
        else if (ring[i]) c = line;
        else if (s.shadow) {
          const sx = x - s.shadowX,
            sy = y - s.shadowY;
          if (sx >= 0 && sy >= 0 && sx < W && sy < H && ring[sy * W + sx]) c = shade;
        }
        if (c) full.data.set([c[0], c[1], c[2], 255], i * 4);
      }
    } else {
      ctx.clearRect(0, 0, W, H);
      ctx.lineJoin = "round";
      const draw = (dx: number, dy: number, f: string, o: string | null) => {
        if (o && s.outline > 0) {
          ctx.strokeStyle = o;
          ctx.lineWidth = s.outline * 2;
          ctx.strokeText(ch, penX + dx, penY + dy);
        }
        ctx.fillStyle = f;
        ctx.fillText(ch, penX + dx, penY + dy);
      };
      if (s.shadow) draw(s.shadowX, s.shadowY, s.shadowColor, s.shadowColor);
      draw(0, 0, s.color, s.outlineColor);
      full.data.set(ctx.getImageData(0, 0, W, H).data);
    }
    const b = opaqueBounds(full);
    if (!b) glyphs.push({ id, img: null, xoffset: 0, yoffset: 0, xadvance: adv });
    else glyphs.push({ id, img: cropImage(full, b.x, b.y, b.w, b.h), xoffset: b.x - penX, yoffset: b.y - (penY - base), xadvance: adv });
  }

  /* pages */
  const drawn = glyphs.map((g, i) => ({ g, i })).filter((x) => x.g.img);
  const chars: BmChar[] = glyphs.map((g) => ({ id: g.id, x: 0, y: 0, width: g.img?.width ?? 0, height: g.img?.height ?? 0, xoffset: g.xoffset, yoffset: g.yoffset, xadvance: g.xadvance, page: 0, chnl: 15 }));
  const pages: RGBAImage[] = [];
  const settings = { ...PACK_DEFAULTS, method: "maxrects" as const, allowRotate: false, padding: s.padding, border: 0, extrude: 0 };
  let side = s.page;
  if (!side) {
    const r = pack(
      drawn.map((x) => ({ w: x.g.img!.width, h: x.g.img!.height })),
      { ...settings, size: "auto", pot: true, square: true },
    );
    side = r.overflow.length || r.width > 2048 ? 2048 : r.width;
  }
  let remaining = drawn;
  while (remaining.length) {
    const r = pack(
      remaining.map((x) => ({ w: x.g.img!.width, h: x.g.img!.height })),
      { ...settings, size: "manual", width: side, height: side },
    );
    if (!r.placements.length) throw new Error(`A glyph is larger than a ${side}×${side} page. Choose a bigger page size or a smaller font size.`);
    const p = pages.length;
    for (const pl of r.placements) {
      const c = chars[remaining[pl.index]!.i]!;
      c.x = pl.x;
      c.y = pl.y;
      c.page = p;
    }
    pages.push(compose(remaining.map((x) => x.g.img!), r, 0));
    remaining = r.overflow.map((i) => remaining[i]!);
    if (pages.length > 64) throw new Error("More than 64 pages. Choose a larger page size or fewer characters.");
  }

  /* kerning from the browser's own shaping, for manageable charsets */
  const kernings: BmFont["kernings"] = [];
  if (s.kerning && present.length <= KERNING_LIMIT) {
    const width = new Map(present.map((c) => [c, ctx.measureText(String.fromCodePoint(c)).width]));
    for (const a of present)
      for (const b of present) {
        if (a === 32 || b === 32) continue;
        const k = Math.round(ctx.measureText(String.fromCodePoint(a, b)).width - width.get(a)! - width.get(b)!);
        if (k) kernings.push({ first: a, second: b, amount: k });
      }
  }

  const font: BmFont = {
    info: { face: info.names.family || family, size: s.size, bold: 0, italic: 0, charset: "", unicode: 1, stretchH: 100, smooth: s.render === "smooth" ? 1 : 0, aa: 1, padding: [0, 0, 0, 0], spacing: [s.padding, s.padding], outline: s.outline },
    common: { lineHeight, base, scaleW: side, scaleH: side, pages: pages.length, packed: 0, alphaChnl: 0, redChnl: 0, greenChnl: 0, blueChnl: 0 },
    pages: pages.map((_, i) => `${name}_${i}.png`),
    chars,
    kernings,
  };
  return { font, pages, missing, ms: Math.round(performance.now() - t0) };
}
