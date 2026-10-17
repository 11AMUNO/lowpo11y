import { describe, expect, it } from "vitest";
import { nearestPowerOfTwo, outputFormat, plannedSize, RESIZE_DEFAULTS } from "./resize-plan";

describe("resize plan", () => {
  it("computes sizes for each mode and snaps to powers of two", () => {
    expect(plannedSize(1920, 1080, { ...RESIZE_DEFAULTS, mode: "long", width: 512 })).toEqual([512, 288]);
    expect(plannedSize(1920, 1080, { ...RESIZE_DEFAULTS, mode: "long", width: 512, pot: true })).toEqual([512, 256]);
    expect(plannedSize(300, 200, { ...RESIZE_DEFAULTS, mode: "scale", scale: 50 })).toEqual([150, 100]);
    expect(plannedSize(300, 200, { ...RESIZE_DEFAULTS, mode: "exact", width: 64, height: 32 })).toEqual([64, 32]);
    expect(plannedSize(3, 3, { ...RESIZE_DEFAULTS, mode: "scale", scale: 1 })).toEqual([1, 1]);
    expect([3, 96, 100, 181, 182].map(nearestPowerOfTwo)).toEqual([4, 128, 128, 128, 256]);
  });

  it("keeps the input format only when asked", () => {
    expect(outputFormat({ ...RESIZE_DEFAULTS, format: "keep" }, "image/jpeg")).toBe("jpg");
    expect(outputFormat({ ...RESIZE_DEFAULTS, format: "keep" }, "image/gif")).toBe("png");
    expect(outputFormat({ ...RESIZE_DEFAULTS, format: "webp" }, "image/png")).toBe("webp");
  });
});
