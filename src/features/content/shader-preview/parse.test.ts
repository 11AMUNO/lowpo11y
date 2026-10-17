import { describe, expect, it } from "vitest";
import { PSX_MATERIAL_GLSL } from "@/lib/shaders/psx-material";
import { parseControls, splitStages } from "./parse";

describe("three.js shader convention", () => {
  it("splits the PSX material into its two stages", () => {
    const s = splitStages(PSX_MATERIAL_GLSL)!;
    expect(s.vertex.startsWith("// --- vertex ---")).toBe(true);
    expect(s.vertex).toContain("gl_Position");
    expect(s.vertex).not.toContain("gl_FragColor");
    expect(s.fragment.startsWith("// --- fragment ---")).toBe(true);
    expect(s.fragment).toContain("gl_FragColor");
  });

  it("reads slider annotations from either stage", () => {
    expect(parseControls(PSX_MATERIAL_GLSL)).toEqual([
      { name: "uSnap", label: "Vertex snap (rows)", min: 40, max: 480, value: 120, step: 1 },
      { name: "uAffine", label: "Affine warp", min: 0, max: 1, value: 1, step: 0.01 },
      { name: "uLevels", label: "Colour levels", min: 4, max: 32, value: 32, step: 1 },
      { name: "uDither", label: "Dither", min: 0, max: 1, value: 1, step: 0.01 },
    ]);
  });

  it("ignores files without the markers and malformed controls", () => {
    expect(splitStages("void main() { gl_FragColor = vec4(1.0); }")).toBeNull();
    expect(splitStages("// --- vertex ---\nfloat x;\n// --- fragment ---\nvoid main() {}")).toBeNull();
    expect(parseControls("uniform float a; // @control 5..1 = 2\nuniform float b; // @control 0..1 = 9\nuniform float b; // @control 0..2 = 1")).toEqual([
      { name: "b", label: "b", min: 0, max: 1, value: 1, step: 0.01 },
    ]);
  });
});
