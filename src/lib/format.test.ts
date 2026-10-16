import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, pluralise } from "./format";

describe("formatBytes", () => {
  it.each([
    [0, "0 B"],
    [1023, "1023 B"],
    [1024, "1 KB"],
    [1536, "1.5 KB"],
    [5 * 1024 * 1024, "5 MB"],
    [250 * 1024 * 1024, "250 MB"],
  ])("%d → %s", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });
  it("handles invalid input", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("pluralise", () => {
  it("uses singular for one", () => expect(pluralise(1, "asset")).toBe("1 asset"));
  it("uses plural otherwise", () => expect(pluralise(12480, "triangle")).toBe("12,480 triangles"));
  it("accepts irregular plurals", () => expect(pluralise(2, "vertex", "vertices")).toBe("2 vertices"));
});

describe("formatCount", () => {
  it("adds separators", () => expect(formatCount(1234567)).toBe("1,234,567"));
});
