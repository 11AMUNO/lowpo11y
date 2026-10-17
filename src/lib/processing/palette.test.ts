import { describe, expect, it } from "vitest";
import { createImage, hexToRgb, setPixel, type RGB, type RGBAImage } from "./image";
import { BUILTIN_PALETTES, confusablePairs, deltaE, extractPalette, harmony, HARMONIES, oklabToRgb, rgbToOklab, simulateCvd } from "./palette";
import { remapImage } from "./remap";

/** Blocks of known colours with known areas, plus a transparent stripe of a colour that must be ignored. */
function blocks(): RGBAImage {
  const img = createImage(100, 60);
  const cols: [RGB, number][] = [
    [[200, 30, 30], 40],
    [[30, 160, 40], 30],
    [[40, 60, 200], 20],
    [[240, 220, 60], 10],
  ];
  let x0 = 0;
  for (const [c, w] of cols) {
    for (let y = 0; y < 50; y++) for (let x = x0; x < x0 + w; x++) setPixel(img, x, y, [c[0] + ((x + y) % 3), c[1], c[2], 255]);
    x0 += w;
  }
  for (let y = 50; y < 60; y++) for (let x = 0; x < 100; x++) setPixel(img, x, y, [255, 0, 255, 0]);
  return img;
}

describe("OKLab", () => {
  it("round-trips sRGB within one level and orders lightness", () => {
    for (let r = 0; r < 256; r += 17)
      for (let g = 0; g < 256; g += 51)
        for (let b = 0; b < 256; b += 85) {
          const back = oklabToRgb(rgbToOklab([r, g, b]));
          expect(Math.max(Math.abs(back[0] - r), Math.abs(back[1] - g), Math.abs(back[2] - b))).toBeLessThanOrEqual(1);
        }
    expect(rgbToOklab([255, 255, 255])[0]).toBeCloseTo(1, 3);
    expect(rgbToOklab([0, 0, 0])[0]).toBeCloseTo(0, 6);
    expect(deltaE([10, 10, 10], [10, 10, 10])).toBe(0);
    expect(deltaE([0, 0, 0], [255, 255, 255])).toBeGreaterThan(99);
  });
});

describe("extractPalette", () => {
  const img = blocks();

  it("finds the dominant colours, ignores transparent pixels and is deterministic", () => {
    const pal = extractPalette(img, { count: 4 });
    expect(pal).toHaveLength(4);
    for (const want of [[200, 30, 30], [30, 160, 40], [40, 60, 200], [240, 220, 60]] as RGB[]) expect(Math.min(...pal.map((c) => deltaE(c, want)))).toBeLessThan(2);
    expect(pal.some((c) => deltaE(c, [255, 0, 255]) < 10)).toBe(false);
    expect(extractPalette(img, { count: 4 })).toEqual(pal);
    // dark to light
    const L = pal.map((c) => rgbToOklab(c)[0]);
    expect([...L].sort((a, b) => a - b)).toEqual(L);
  });

  it("keeps locked colours exactly, first and in order, and fills the remaining slots", () => {
    const locked: RGB[] = [
      [0, 0, 0],
      [200, 30, 30],
    ];
    const pal = extractPalette(img, { count: 4, locked });
    expect(pal.slice(0, 2)).toEqual(locked);
    expect(pal).toHaveLength(4);
    // the locked red claims the red block, so no second near-red is added
    expect(pal.slice(2).some((c) => deltaE(c, [200, 30, 30]) < 5)).toBe(false);
    expect(extractPalette(img, { count: 2, locked })).toEqual(locked);
  });

  it("never returns more colours than the image has", () => {
    const flat = createImage(8, 8, [12, 34, 56, 255]);
    expect(extractPalette(flat, { count: 16 })).toEqual([[12, 34, 56]]);
    expect(extractPalette(createImage(4, 4), { count: 8 })).toEqual([]);
  });

  it("is fast enough for a 1024² image", () => {
    const big = createImage(1024, 1024);
    for (let i = 0; i < big.data.length; i += 4) big.data.set([(i * 7) % 256, (i * 13) % 256, (i * 29) % 256, 255], i);
    const t = performance.now();
    expect(extractPalette(big, { count: 32 }).length).toBeLessThanOrEqual(32);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});

describe("harmonies", () => {
  it("rotate hue while keeping lightness", () => {
    const base: RGB = [180, 80, 60];
    const [L] = rgbToOklab(base);
    for (const h of HARMONIES) {
      const out = harmony(base, h.id);
      expect(out.length).toBeGreaterThan(0);
      if (h.id !== "shades") for (const c of out) expect(Math.abs(rgbToOklab(c)[0] - L)).toBeLessThan(0.08);
    }
    const [comp] = harmony(base, "complementary");
    const a = rgbToOklab(base),
      b = rgbToOklab(comp!);
    expect(Math.sign(a[1]) * Math.sign(b[1])).toBeLessThanOrEqual(0); // opposite side of the a axis
  });
});

describe("colour-vision simulation", () => {
  it("keeps greys grey and flags red/green confusion for deuteranopia", () => {
    for (const v of [0, 128, 255]) for (const k of ["protanopia", "deuteranopia", "tritanopia"] as const) simulateCvd([v, v, v], k).forEach((c) => expect(Math.abs(c - v)).toBeLessThanOrEqual(2));
    const pairs = confusablePairs([hexToRgb("#cc3333"), hexToRgb("#6b8e23"), hexToRgb("#3355ff")], "deuteranopia", 10);
    expect(pairs).toContainEqual([0, 1]);
  });
});

describe("built-in palettes", () => {
  it("are valid, unique and remap onto exactly their own colours", () => {
    const ids = new Set<string>();
    const img = blocks();
    for (const p of BUILTIN_PALETTES) {
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      const rgb = p.colours.map(hexToRgb);
      expect(new Set(p.colours).size).toBe(p.colours.length);
      const copy = { ...img, data: new Uint8ClampedArray(img.data) };
      remapImage(copy, { palette: rgb, dither: "fs", strength: 1, wrap: true });
      const allowed = new Set(rgb.map((c) => c.join()));
      for (let i = 0; i < copy.data.length; i += 4) if (copy.data[i + 3]! > 0) expect(allowed.has(`${copy.data[i]},${copy.data[i + 1]},${copy.data[i + 2]}`)).toBe(true);
    }
  });
});
