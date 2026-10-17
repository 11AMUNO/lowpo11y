import { describe, expect, it } from "vitest";
import { buildCharset, parseRanges } from "@/lib/fonts/charset";
import { createImage, getPixel, setPixel } from "@/lib/processing/image";
import { parseBmfontJson, parseBmfontText, renderBmfont, toBmfontJson, toBmfontText, type BmFont } from "./bmfont";

/** A 2-glyph font on an 8×4 page: "A" is a 2×3 red block, "B" a 3×2 green block, plus space. */
function font(): { f: BmFont; page: ReturnType<typeof createImage> } {
  const page = createImage(8, 4);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 2; x++) setPixel(page, x, y, [255, 0, 0, 255]);
  for (let y = 0; y < 2; y++) for (let x = 4; x < 7; x++) setPixel(page, x, y, [0, 255, 0, 128]);
  const f: BmFont = {
    info: { face: 'Test "Face"', size: 4, bold: 0, italic: 0, charset: "", unicode: 1, stretchH: 100, smooth: 0, aa: 1, padding: [0, 0, 0, 0], spacing: [1, 1], outline: 0 },
    common: { lineHeight: 5, base: 4, scaleW: 8, scaleH: 4, pages: 1, packed: 0, alphaChnl: 0, redChnl: 0, greenChnl: 0, blueChnl: 0 },
    pages: ["test_0.png"],
    chars: [
      { id: 32, x: 0, y: 0, width: 0, height: 0, xoffset: 0, yoffset: 0, xadvance: 2, page: 0, chnl: 15 },
      { id: 65, x: 0, y: 0, width: 2, height: 3, xoffset: 0, yoffset: 1, xadvance: 3, page: 0, chnl: 15 },
      { id: 66, x: 4, y: 0, width: 3, height: 2, xoffset: 1, yoffset: 2, xadvance: 4, page: 0, chnl: 15 },
    ],
    kernings: [{ first: 65, second: 66, amount: -1 }],
  };
  return { f, page };
}

describe("BMFont files", () => {
  it("text and JSON round-trip", () => {
    const { f } = font();
    const text = toBmfontText(f);
    expect(text).toContain('info face="Test \'Face\'" size=4');
    expect(text).toContain("char id=32 x=0 y=0 width=0 height=0 xoffset=0 yoffset=0 xadvance=2 page=0 chnl=15");
    expect(text).toContain("kerning first=65 second=66 amount=-1");
    const back = parseBmfontText(text);
    expect(back.chars).toEqual(f.chars);
    expect(back.common).toEqual(f.common);
    expect(back.kernings).toEqual(f.kernings);
    expect(back.info.face).toBe("Test 'Face'");
    const j = parseBmfontJson(toBmfontJson(f));
    expect(j.chars).toEqual(f.chars);
    expect(JSON.parse(toBmfontJson(f)).chars[1].char).toBe("A");
    expect(() => parseBmfontText("hello")).toThrow(/Not a BMFont/);
  });

  it("renders with advances, offsets, kerning, spaces, newlines and a fallback", () => {
    const { f, page } = font();
    const r = renderBmfont(f, [page], "AB A\nB");
    // A at pen 0; B at pen 3 - 1 (kerning) = 2, box at 2 + 1; space at pen 6; A at pen 8; B starts line 2 (y 5 + 2)
    expect(r.glyphs.map((g) => [g.id, g.x, g.y, g.penX])).toEqual([
      [65, 0, 1, 0],
      [66, 3, 2, 2],
      [32, 6, 0, 6],
      [65, 8, 1, 8],
      [66, 1, 7, 0],
    ]);
    expect([r.image.width, r.image.height]).toEqual([11, 10]);
    expect(getPixel(r.image, 0, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(r.image, 3, 2)).toEqual([0, 255, 0, 128]);
    expect(getPixel(r.image, 0, 0)[3]).toBe(0);
    // missing characters: skipped (no "?" in this font) and reported
    expect(renderBmfont(f, [page], "AéA").missing).toEqual([0xe9]);
    expect(renderBmfont(f, [page], "AéA").glyphs).toHaveLength(2);
  });
});

describe("charsets", () => {
  it("parses ranges in the usual spellings", () => {
    expect(parseRanges("U+0020-007E, 0x41 U+2190–U+2192")).toEqual([
      [0x20, 0x7e],
      [0x41, 0x41],
      [0x2190, 0x2192],
    ]);
    expect(() => parseRanges("hello")).toThrow(/isn't a range/);
    expect(() => parseRanges("U+110000")).toThrow(/U\+10FFFF/);
  });

  it("combines presets, characters and ranges without controls or duplicates", () => {
    const cs = buildCharset(["ascii"], "éA😀\u0007", "U+2190-2191");
    expect(cs.length).toBe(95 + 1 + 1 + 2);
    expect(cs).toContain(0x1f600);
    expect(cs).not.toContain(7);
    expect(cs[0]).toBe(0x20);
    expect(() => buildCharset([], "", "U+0000-FFFF")).toThrow(/more than/);
  });
});
