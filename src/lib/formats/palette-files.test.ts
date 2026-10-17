import { describe, expect, it } from "vitest";
import { encodePng } from "./png";
import { fromGpl, fromHex, fromJson, fromSwatchImage, parsePaletteText, toGpl, toHex, toJson, toSwatchImage, type PaletteDoc } from "./palette-files";
import sharp from "sharp";

const doc: PaletteDoc = {
  name: "Rust belt",
  colours: [
    { rgb: [26, 20, 20], name: "Soot", locked: true },
    { rgb: [184, 103, 46], name: "Rust orange" },
    { rgb: [216, 196, 106] },
    { rgb: [255, 255, 255], name: "Paint white" },
  ],
};
const strip = (d: PaletteDoc) => ({ name: d.name, colours: d.colours.map((c) => ({ rgb: c.rgb, name: c.name })) });

describe("palette files", () => {
  it("GPL round-trips names and colours", () => {
    const text = toGpl(doc);
    expect(text.split("\n")[0]).toBe("GIMP Palette");
    expect(text).toContain("Name: Rust belt");
    expect(text).toContain("184 103  46\tRust orange");
    expect(strip(fromGpl(text))).toEqual(strip(doc));
    expect(() => fromGpl("not a palette")).toThrow(/GIMP Palette/);
  });

  it("reads GPL files from other apps (tabs, comments, Columns)", () => {
    const gimp = "GIMP Palette\r\nName: Test\r\nColumns: 4\r\n#\r\n# a comment\r\n 15  56  15\tDarkest Green\r\n155\t188\t15\tLightest\r\n300 0 0 bad\r\n";
    expect(fromGpl(gimp)).toEqual({ name: "Test", colours: [{ rgb: [15, 56, 15], name: "Darkest Green" }, { rgb: [155, 188, 15], name: "Lightest" }] });
  });

  it("HEX round-trips colours in order", () => {
    const text = toHex(doc);
    expect(text).toBe("1a1414\nb8672e\nd8c46a\nffffff\n");
    expect(fromHex(text).colours.map((c) => c.rgb)).toEqual(doc.colours.map((c) => c.rgb));
    expect(fromHex("#ff0000, #00FF00; 0000ff ff0000").colours.map((c) => c.rgb)).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
  });

  it("JSON round-trips names and locks, and accepts bare hex arrays", () => {
    const text = toJson(doc);
    expect(JSON.parse(text)).toMatchObject({ format: "lowpo11y-palette", version: 1, name: "Rust belt" });
    expect(fromJson(text)).toEqual({ name: doc.name, colours: doc.colours.map((c) => ({ rgb: c.rgb, name: c.name, locked: c.locked })) });
    expect(fromJson('["#000000", "#ffffff", "nope"]').colours.map((c) => c.rgb)).toEqual([
      [0, 0, 0],
      [255, 255, 255],
    ]);
    expect(() => fromJson("{")).toThrow(/parsed/);
    expect(() => fromJson('{"colours": []}')).toThrow(/No valid/);
  });

  it("PNG swatches round-trip through a real PNG file at any cell size and column count", async () => {
    const rgb = doc.colours.map((c) => c.rgb);
    for (const [cell, cols] of [[1, 4], [8, 4], [16, 3], [32, 1]] as const) {
      const img = toSwatchImage(rgb, cell, cols);
      expect([img.width, img.height]).toEqual([cell * cols, cell * Math.ceil(4 / cols)]);
      const { data, info } = await sharp(encodePng(img)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(fromSwatchImage({ width: info.width, height: info.height, data: new Uint8ClampedArray(data) })).toEqual(rgb);
    }
  });

  it("detects the format from content", () => {
    expect(parsePaletteText(toGpl(doc)).name).toBe("Rust belt");
    expect(parsePaletteText(toJson(doc)).colours).toHaveLength(4);
    expect(parsePaletteText("#123456 #abcdef").colours).toHaveLength(2);
    expect(() => parsePaletteText("hello")).toThrow(/No colours/);
  });
});
