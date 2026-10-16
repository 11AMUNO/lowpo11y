import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hasTransparency } from "@/lib/processing/image";
import { DEMO_TEXTURES, renderDemoTexture } from "./textures";

const digest = (d: Uint8ClampedArray) => createHash("sha256").update(d).digest("hex");

describe("demo textures", () => {
  it("have unique slugs prefixed demo-", () => {
    const slugs = DEMO_TEXTURES.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    slugs.forEach((s) => expect(s).toMatch(/^demo-[a-z0-9-]+$/));
  });

  it.each(DEMO_TEXTURES.map((t) => [t.slug, t] as const))("%s renders deterministically at exact size", (_slug, def) => {
    const a = def.recipe(64);
    const b = def.recipe(64);
    expect(a.width).toBe(64);
    expect(a.height).toBe(64);
    expect(digest(a.data)).toBe(digest(b.data));
    expect(hasTransparency(a)).toBe(def.hasAlpha);
  });

  it("tiles seamlessly: wrap-around edge difference is comparable to interior difference", () => {
    for (const def of DEMO_TEXTURES) {
      const img = renderDemoTexture(def.slug, 128);
      const lum = (x: number, y: number) => {
        const i = (y * 128 + x) * 4;
        return img.data[i]! * 0.3 + img.data[i + 1]! * 0.59 + img.data[i + 2]! * 0.11;
      };
      let edge = 0;
      let interior = 0;
      for (let y = 0; y < 128; y++) {
        edge += Math.abs(lum(127, y) - lum(0, y));
        interior += Math.abs(lum(63, y) - lum(64, y));
      }
      // A non-tiling texture typically shows a seam many times larger than an interior column step.
      expect(edge, def.slug).toBeLessThan(interior * 3 + 128 * 12);
    }
  });
});
