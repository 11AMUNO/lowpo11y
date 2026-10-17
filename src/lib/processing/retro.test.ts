import { describe, expect, it } from "vitest";
import { blueNoise } from "./blue-noise";
import { createImage, getPixel, setPixel, type RGBAImage } from "./image";
import { countColours, medianCut, parsePalette, quantizeChannel } from "./quantize";
import { fitTo, longSideSize, resize, resizeNearest, resizeSmooth } from "./resample";
import { convertRetro, outputSize, RETRO_PRESETS } from "./retro";

function gradient(w: number, h: number, alphaHole = false): RGBAImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const hole = alphaHole && x >= w / 4 && x < (w * 3) / 4 && y >= h / 4 && y < (h * 3) / 4;
      setPixel(img, x, y, [Math.round((x / (w - 1)) * 255), Math.round((y / (h - 1)) * 255), (x * 7 + y * 3) % 256, hole ? 0 : x % 5 === 0 ? 128 : 255]);
    }
  return img;
}

describe("resampling", () => {
  it("nearest picks the texel under each output centre", () => {
    const src = createImage(2, 2);
    setPixel(src, 0, 0, [255, 0, 0, 255]);
    setPixel(src, 1, 0, [0, 255, 0, 255]);
    setPixel(src, 0, 1, [0, 0, 255, 255]);
    setPixel(src, 1, 1, [255, 255, 255, 255]);
    const up = resizeNearest(src, 4, 4);
    expect(getPixel(up, 1, 1)).toEqual([255, 0, 0, 255]);
    expect(getPixel(up, 2, 1)).toEqual([0, 255, 0, 255]);
    expect(getPixel(up, 3, 3)).toEqual([255, 255, 255, 255]);
    expect(resizeNearest(up, 2, 2).data).toEqual(src.data);
  });

  it("smooth keeps flat colours flat and never darkens edges against transparency", () => {
    const flat = createImage(37, 23, [90, 140, 200, 255]);
    for (const [w, h] of [[8, 5], [64, 64], [37, 23]] as const) {
      const r = resizeSmooth(flat, w, h);
      for (let i = 0; i < r.data.length; i += 4) expect([r.data[i], r.data[i + 1], r.data[i + 2], r.data[i + 3]]).toEqual([90, 140, 200, 255]);
    }
    // half opaque red, half fully transparent black: resized edge pixels stay pure red
    const half = createImage(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) setPixel(half, x, y, [255, 0, 0, 255]);
    const r = resizeSmooth(half, 5, 5);
    for (let i = 0; i < r.data.length; i += 4) if (r.data[i + 3]! > 0) expect([r.data[i], r.data[i + 1], r.data[i + 2]]).toEqual([255, 0, 0]);
  });

  it("fit modes always give the exact requested size", () => {
    const src = gradient(300, 120);
    for (const fit of ["stretch", "crop", "pad"] as const)
      for (const sampling of ["nearest", "smooth"] as const)
        for (const [w, h] of [[32, 32], [64, 128], [100, 30], [1, 1]] as const) {
          const out = fitTo(src, w, h, fit, sampling);
          expect([out.width, out.height, out.data.length]).toEqual([w, h, w * h * 4]);
        }
    // pad leaves transparent margins, crop doesn't
    expect(getPixel(fitTo(src, 64, 64, "pad", "nearest"), 32, 0)[3]).toBe(0);
    expect(getPixel(fitTo(src, 64, 64, "crop", "nearest"), 32, 0)[3]).toBeGreaterThan(0);
    expect(longSideSize(300, 120, 128)).toEqual([128, 51]);
    expect(resize(src, 300, 120, "smooth").data).toEqual(src.data);
  });
});

describe("quantisation", () => {
  it("channel bit depth replicates bits so full scale stays 255", () => {
    expect([0, 255].map((v) => quantizeChannel(v, 5))).toEqual([0, 255]);
    expect(quantizeChannel(132, 5)).toBe(132);
    expect(new Set(Array.from({ length: 256 }, (_, v) => quantizeChannel(v, 5))).size).toBe(32);
    expect(new Set(Array.from({ length: 256 }, (_, v) => quantizeChannel(v, 2)))).toEqual(new Set([0, 85, 170, 255]));
  });

  it("median cut returns at most N unique colours from opaque pixels only", () => {
    const img = gradient(64, 64, true);
    const pal = medianCut(img, 16);
    expect(pal.length).toBeLessThanOrEqual(16);
    expect(new Set(pal.map((c) => c.join())).size).toBe(pal.length);
    expect(medianCut(createImage(4, 4), 8)).toEqual([[0, 0, 0]]);
  });

  it("parses hex lists and GIMP palettes", () => {
    expect(parsePalette("#ff0000\n00ff00, #0000FF\n#ff0000")).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
    ]);
    expect(parsePalette("GIMP Palette\nName: Test\nColumns: 4\n# comment\n 15  56  15\tDarkest\n155 188 15 Lightest\n")).toEqual([
      [15, 56, 15],
      [155, 188, 15],
    ]);
  });
});

describe("blue noise", () => {
  it("is a tileable ranking: every threshold appears exactly once", () => {
    const m = blueNoise(32, 3);
    const ranks = Array.from(m, (v) => Math.round(v * 1024 - 0.5)).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: 1024 }, (_, i) => i));
    expect(blueNoise(32, 3)).toBe(m); // cached
  });
});

describe("convertRetro", () => {
  const src = gradient(200, 150, true);

  it("outputs exactly the requested size with alpha preserved", () => {
    const r = convertRetro(src, { width: 64, height: 32, fit: "stretch", sampling: "nearest" });
    expect([r.image.width, r.image.height]).toEqual([64, 32]);
    expect(r.transparent).toBe(true);
    // keep mode: alpha comes straight from the resized base
    for (let i = 3; i < r.image.data.length; i += 4) expect(r.image.data[i]).toBe(r.base.data[i]);
    expect(outputSize(200, 150, { sizeMode: "long", width: 128, height: 0 })).toEqual([128, 96]);
  });

  it("cutout makes alpha strictly 0 or 255 and zeroes transparent colour", () => {
    const r = convertRetro(src, { alpha: "cutout", alphaThreshold: 200 });
    for (let i = 0; i < r.image.data.length; i += 4) {
      expect([0, 255]).toContain(r.image.data[i + 3]);
      if (r.image.data[i + 3] === 0) expect([r.image.data[i], r.image.data[i + 1], r.image.data[i + 2]]).toEqual([0, 0, 0]);
    }
  });

  it("uses only palette colours, with every dither mode", () => {
    for (const dither of ["none", "bayer2", "bayer4", "bayer8", "blue", "fs"] as const) {
      const r = convertRetro(src, { palette: "adaptive", colours: 8, dither, bits: { r: 8, g: 8, b: 8 } });
      const pal = new Set(r.palette.map((c) => c.join()));
      expect(r.palette.length).toBeLessThanOrEqual(8);
      for (let i = 0; i < r.image.data.length; i += 4)
        if (r.image.data[i + 3]! > 0) expect(pal.has(`${r.image.data[i]},${r.image.data[i + 1]},${r.image.data[i + 2]}`)).toBe(true);
    }
  });

  it("locked palettes are honoured exactly", () => {
    const locked: [number, number, number][] = [
      [10, 20, 30],
      [200, 100, 50],
      [255, 255, 255],
    ];
    const r = convertRetro(src, { palette: "locked", locked, bits: { r: 8, g: 8, b: 8 }, dither: "fs" });
    expect(r.palette).toEqual(locked);
    expect(r.colours).toBeLessThanOrEqual(3);
  });

  it("bit depth without a palette lands on the RGB555 grid", () => {
    const r = convertRetro(src, { palette: "off", bits: { r: 5, g: 5, b: 5 }, dither: "bayer4" });
    const grid = new Set(Array.from({ length: 32 }, (_, q) => quantizeChannel((q * 255) / 31, 5)));
    for (let i = 0; i < r.image.data.length; i += 4) if (r.image.data[i + 3]! > 0) for (let c = 0; c < 3; c++) expect(grid.has(r.image.data[i + c]!)).toBe(true);
  });

  it("is deterministic for a fixed seed, and the seed changes grain", () => {
    const a = convertRetro(src, { grain: 20, seed: 7, dither: "fs" });
    const b = convertRetro(src, { grain: 20, seed: 7, dither: "fs" });
    const c = convertRetro(src, { grain: 20, seed: 8, dither: "fs" });
    expect(a.image.data).toEqual(b.image.data);
    expect(a.image.data).not.toEqual(c.image.data);
  });

  it("presets all run and stay within their palette size", () => {
    for (const p of RETRO_PRESETS) {
      const r = convertRetro(src, p.settings);
      if (p.settings.palette === "adaptive") expect(countColours(r.image)).toBeLessThanOrEqual(p.settings.colours!);
      if (p.settings.palette === "locked") expect(countColours(r.image)).toBeLessThanOrEqual(p.settings.locked!.length);
    }
  });
});
