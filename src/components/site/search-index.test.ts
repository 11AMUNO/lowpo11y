import { describe, expect, it } from "vitest";
import { buildStaticIndex, searchStatic } from "./search-index";

describe("command palette index", () => {
  const index = buildStaticIndex();

  it("lists every available tool and the main pages", () => {
    expect(index.filter((r) => r.kind === "tool").map((r) => r.href)).toContain("/tools/bitmap-font");
    expect(index.some((r) => r.href === "/licences")).toBe(true);
  });

  it("ranks title matches above description-only matches", () => {
    // "licen" is in the Licences page title and in the bitmap font tool's description
    const r = searchStatic(index, "licen");
    expect(r[0]!.href).toBe("/licences");
    expect(r.map((x) => x.href)).toContain("/tools/bitmap-font");
    expect(searchStatic(index, "atlas")[0]!.href).toBe("/tools/texture-atlas");
    expect(searchStatic(index, "  ")).toEqual([]);
    expect(searchStatic(index, "zzqx")).toEqual([]);
  });

  it("needs every word to match", () => {
    expect(searchStatic(index, "palette gpl").map((x) => x.href)).toEqual(["/tools/palette"]);
  });
});
