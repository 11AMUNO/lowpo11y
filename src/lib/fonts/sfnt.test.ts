import { describe, expect, it } from "vitest";
import { buildPixelFont, pixelFontGlyphs } from "@/lib/demo/pixel-font";
import { glyphRects } from "./pixel-ttf";
import { embeddingNote, FontError, readFont } from "./sfnt";

describe("pixel TrueType writer + sfnt reader", () => {
  const font = buildPixelFont();

  it("is reproducible and reads back with every character mapped", () => {
    expect(buildPixelFont()).toEqual(font);
    const info = readFont(font);
    expect(info.format).toBe("truetype");
    expect(info.unitsPerEm).toBe(1000);
    expect([info.ascender, info.descender, info.lineGap]).toEqual([800, -200, 0]);
    const glyphs = pixelFontGlyphs();
    expect(info.numGlyphs).toBe(glyphs.length + 1); // + .notdef
    for (const g of glyphs) expect(info.cmap.has(g.codepoint), String.fromCodePoint(g.codepoint)).toBe(true);
    expect(info.cmap.has("é".codePointAt(0)!)).toBe(false);
    expect(new Set(info.cmap.values()).size).toBe(glyphs.length);
    expect(info.names.family).toBe("LOWPO11Y Pixel");
    expect(info.names.license).toMatch(/^CC0 1.0/);
    expect(info.names.licenseUrl).toBe("https://creativecommons.org/publicdomain/zero/1.0/");
    expect(info.fsType).toBe(0);
    // whole-font checksum is the magic number once checksumAdjustment is in place
    let sum = 0;
    for (let i = 0; i < font.length; i += 4) sum = (sum + (((font[i] ?? 0) << 24) | ((font[i + 1] ?? 0) << 16) | ((font[i + 2] ?? 0) << 8) | (font[i + 3] ?? 0))) >>> 0;
    expect(sum).toBe(0xb1b0afba);
  });

  it("merges lit pixels into rectangles", () => {
    expect(glyphRects(["##.", "##.", "..#"])).toEqual([
      { x0: 0, x1: 2, y0: 0, y1: 2 },
      { x0: 2, x1: 3, y0: 2, y1: 3 },
    ]);
    expect(glyphRects([".#.", "###", ".#."])).toHaveLength(3);
  });

  it("refuses web fonts and garbage clearly, and explains restricted embedding", () => {
    expect(() => readFont(new TextEncoder().encode("wOF2xxxxxxxxxxxx"))).toThrow(/WOFF/);
    expect(() => readFont(new Uint8Array(40))).toThrow(FontError);
    expect(() => readFont(font.subarray(0, 100))).toThrow(FontError);
    expect(embeddingNote(0x0002)).toMatch(/restricted/);
    expect(embeddingNote(0)).toBeNull();
  });
});
