import { describe, expect, it } from "vitest";
import { bayerMatrix, posterizeOrdered } from "./dither";
import { createImage, getPixel, setPixel } from "./image";

describe("bayerMatrix", () => {
  it.each([2, 4, 8] as const)("%i×%i contains each threshold exactly once", (n) => {
    const m = bayerMatrix(n);
    expect(m).toHaveLength(n);
    const flat = m.flat().sort((a, b) => a - b);
    expect(flat).toHaveLength(n * n);
    flat.forEach((v, i) => expect(v).toBeCloseTo((i + 0.5) / (n * n), 10));
  });

  it("matches the canonical 4×4 ordering", () => {
    const m = bayerMatrix(4).map((row) => row.map((v) => Math.round(v * 16 - 0.5)));
    expect(m).toEqual([
      [0, 8, 2, 10],
      [12, 4, 14, 6],
      [3, 11, 1, 9],
      [15, 7, 13, 5],
    ]);
  });
});

describe("posterizeOrdered", () => {
  it("only produces the allowed channel levels", () => {
    const img = createImage(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) setPixel(img, x, y, [x * 16, y * 16, 128, 255]);
    const out = posterizeOrdered(img, 4);
    const allowed = new Set([0, 85, 170, 255]);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(allowed.has(out.data[i]!)).toBe(true);
      expect(allowed.has(out.data[i + 1]!)).toBe(true);
      expect(allowed.has(out.data[i + 2]!)).toBe(true);
    }
  });

  it("preserves alpha exactly", () => {
    const img = createImage(4, 4, [200, 100, 50, 0]);
    setPixel(img, 1, 1, [10, 20, 30, 77]);
    const out = posterizeOrdered(img, 8);
    expect(getPixel(out, 0, 0)[3]).toBe(0);
    expect(getPixel(out, 1, 1)[3]).toBe(77);
  });

  it("dithers a flat mid-grey into a mix of the two nearest levels", () => {
    const img = createImage(8, 8, [128, 128, 128, 255]);
    const out = posterizeOrdered(img, 2, 4, 1);
    const values = new Set<number>();
    for (let i = 0; i < out.data.length; i += 4) values.add(out.data[i]!);
    expect([...values].sort()).toEqual([0, 255]);
  });

  it("is a no-op on values already on a level when strength is 0", () => {
    const img = createImage(2, 2, [255, 0, 255, 255]);
    expect(posterizeOrdered(img, 2, 4, 0).data).toEqual(img.data);
  });

  it("does not mutate the input", () => {
    const img = createImage(2, 2, [100, 100, 100, 255]);
    const copy = new Uint8ClampedArray(img.data);
    posterizeOrdered(img, 4);
    expect(img.data).toEqual(copy);
  });
});
