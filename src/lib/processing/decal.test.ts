import { describe, expect, it } from "vitest";
import { greenScreenSign, SIGN_COLOURS, TAG_COLOURS, tagOnBlack } from "@/lib/demo/decals";
import { applyStrokes, bleed, blurMatte, cornerColour, despeckle, morph, orient, processDecal, subjectBounds } from "./decal";
import { createImage, getPixel, setPixel } from "./image";
import { deltaE } from "./palette";

const sign = greenScreenSign(128);
const tag = tagOnBlack();
const keySign = { key: "colour" as const, keyColours: [SIGN_COLOURS.screen], tolerance: 12, softness: 10 };

/** Semi-transparent pixels of an image. */
const edges = (img: ReturnType<typeof createImage>) => {
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]! > 0 && img.data[i + 3]! < 255) out.push([img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!]);
  return out;
};

describe("decal keying", () => {
  it("removes the green screen and keeps the sign solid", () => {
    const r = processDecal(sign, keySign);
    expect(getPixel(r.output, 2, 2)[3]).toBe(0); // corner: background
    expect(getPixel(r.output, 64, 90)[3]).toBe(255); // inside the sign
    const b = subjectBounds(r.output)!;
    expect(b.w).toBeGreaterThan(100);
    expect(b.y).toBeGreaterThan(10);
  });

  it("keeps subject pixels that touch the image edge", () => {
    // crop into the sign so its yellow fill runs off the bottom edge
    const r = processDecal(greenScreenSign(256), { ...keySign, crop: { x: 145, y: 160, w: 20, h: 30 } });
    for (const [x, y] of [
      [19, 29],
      [10, 29],
      [19, 0],
    ] as const) {
      const p = getPixel(r.output, x, y);
      expect(p[3]).toBe(255);
      expect(deltaE([p[0], p[1], p[2]], SIGN_COLOURS.yellow)).toBeLessThan(6);
    }
  });

  it("decontaminates edges: no green cast left in semi-transparent pixels", () => {
    const greenness = (px: [number, number, number, number][]) => Math.max(...px.map(([r, g, b]) => g - Math.max(r, b)));
    const clean = edges(processDecal(sign, keySign).output);
    const dirty = edges(processDecal(sign, { ...keySign, decontaminate: false }).output);
    expect(clean.length).toBeGreaterThan(20);
    expect(greenness(dirty)).toBeGreaterThan(40);
    expect(greenness(clean)).toBeLessThan(25);
  });

  it("keys light paint off black without a dark fringe", () => {
    const opts = { key: "luma" as const, lumaThreshold: 80, lumaSoftness: 120 };
    const clean = edges(processDecal(tag, opts).output);
    const dirty = edges(processDecal(tag, { ...opts, decontaminate: false }).output);
    const darkest = (px: [number, number, number, number][]) => Math.min(...px.map(([r, g, b]) => (r + g + b) / 3));
    expect(clean.length).toBeGreaterThan(50);
    expect(darkest(dirty)).toBeLessThan(120);
    expect(darkest(clean)).toBeGreaterThan(200);
    for (const [r, g, b] of clean.slice(0, 200)) expect(deltaE([r, g, b], TAG_COLOURS.paint)).toBeLessThan(8);
  });

  it("bleeds colour into transparent pixels so filtering never pulls in black", () => {
    const r = processDecal(tag, { key: "luma", lumaThreshold: 80, lumaSoftness: 120 });
    let transparent = 0;
    for (let i = 0; i < r.output.data.length; i += 4)
      if (r.output.data[i + 3] === 0) {
        transparent++;
        expect((r.output.data[i]! + r.output.data[i + 1]! + r.output.data[i + 2]!) / 3).toBeGreaterThan(200);
      }
    expect(transparent).toBeGreaterThan(1000);
    // and with bleed off, transparent pixels are cleared to 0
    const off = processDecal(tag, { key: "luma", bleed: false });
    expect(getPixel(off.output, 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it("is deterministic and the mask matches the output alpha", () => {
    const a = processDecal(sign, { ...keySign, grime: 40, wear: 30, seed: 5 });
    const b = processDecal(sign, { ...keySign, grime: 40, wear: 30, seed: 5 });
    expect(a.output.data).toEqual(b.output.data);
    for (let i = 0; i < a.output.data.length; i += 4) expect(a.mask.data[i]).toBe(a.output.data[i + 3]);
    expect(processDecal(sign, { ...keySign, wear: 30, seed: 6 }).output.data).not.toEqual(processDecal(sign, { ...keySign, wear: 30, seed: 5 }).output.data);
  });
});

describe("background guess", () => {
  it("finds the screen colour from the corners, and declines when corners disagree", () => {
    const c = cornerColour(sign)!;
    expect(deltaE(c, SIGN_COLOURS.screen)).toBeLessThan(2);
    const mixed = createImage(16, 16, [0, 0, 0, 255]);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) setPixel(mixed, x, y, [255, 255, 255, 255]);
    expect(cornerColour(mixed)).toBeNull();
  });
});

describe("decal geometry and matte tools", () => {
  it("rotates, flips, crops and resizes to exact sizes", () => {
    const img = createImage(4, 2);
    setPixel(img, 0, 0, [255, 0, 0, 255]);
    expect(getPixel(orient(img, 90, false, false), 1, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(orient(img, 0, true, false), 3, 0)).toEqual([255, 0, 0, 255]);
    expect(getPixel(orient(img, 180, false, false), 3, 1)).toEqual([255, 0, 0, 255]);
    const r = processDecal(sign, { ...keySign, rotate: 90, crop: { x: 10, y: 20, w: 100, h: 60 }, size: 64, pot: true });
    expect([r.base.width, r.base.height]).toEqual([100, 60]);
    expect([r.output.width, r.output.height]).toEqual([64, 64]); // 64×38 padded to 64×64
    expect(getPixel(r.output, 0, 0)[3]).toBe(0);
    expect(processDecal(sign, { crop: { x: -5, y: 120, w: 999, h: 999 } }).base.height).toBe(8);
  });

  it("grows, shrinks, despeckles, feathers and paints", () => {
    const w = 20,
      h = 20,
      a = new Float32Array(w * h);
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) a[y * w + x] = 1;
    a[0] = 1; // a lone speck
    const count = (m: Float32Array) => m.reduce((n, v) => n + (v > 0.5 ? 1 : 0), 0);
    expect(count(morph(a, w, h, 1))).toBe(36 + 4);
    expect(count(morph(a, w, h, -1))).toBe(4);
    // shrinking doesn't eat into a matte from the image border
    expect(morph(new Float32Array(w * h).fill(1), w, h, -2).every((v) => v === 1)).toBe(true);
    expect(count(despeckle(a, w, h, 2))).toBe(16);
    const soft = blurMatte(a, w, h, 3);
    expect(soft[10 * w + 10]).toBeLessThan(1);
    expect(soft[10 * w + 13]).toBeGreaterThan(0);
    const m = new Float32Array(a);
    applyStrokes(m, w, h, [{ mode: "erase", r: 2, hardness: 1, points: [[10, 10]] }]);
    expect(m[10 * w + 10]).toBe(0);
    const restored = applyStrokes(m, w, h, [{ mode: "restore", r: 1.5, hardness: 1, points: [[3, 3], [6, 3]] }]);
    expect(m[3 * w + 4]).toBe(1);
    expect(restored![3 * w + 4]).toBe(1);
    expect(applyStrokes(m, w, h, [{ mode: "erase", r: 1, hardness: 1, points: [[1, 1]] }])).toBeNull();
  });

  it("bleed fills every transparent pixel from its nearest visible neighbour", () => {
    const img = createImage(5, 1);
    setPixel(img, 0, 0, [10, 20, 30, 255]);
    setPixel(img, 4, 0, [200, 100, 50, 128]);
    bleed(img);
    expect([getPixel(img, 1, 0), getPixel(img, 3, 0)]).toEqual([
      [10, 20, 30, 0],
      [200, 100, 50, 0],
    ]);
  });
});
