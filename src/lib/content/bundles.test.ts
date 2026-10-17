import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { LicenceInfo } from "@/lib/assets/bundle";
import { buildShaderBundle, codeExtension, testedLine, type ShaderBundleInput } from "./bundles";

const MIT: LicenceInfo = {
  code: "mit",
  human_label: "MIT License",
  short_label: "MIT",
  canonical_url: "https://opensource.org/license/mit",
  commercial_use: true,
  modifications: true,
  attribution_required: true,
  redistribution_allowed: true,
  share_alike: false,
  full_text: null,
  notes: null,
};

const shader: ShaderBundleInput = {
  slug: "affine-warp",
  title: "Affine warp",
  summary: "Texture warping like early consoles.",
  engine: "godot",
  engine_version_min: "4.2",
  engine_version_max: "4.3",
  renderer_compatibility: "Forward+",
  explanation_md: "Interpolates UVs without perspective.",
  setup_md: "",
  limitations_md: "Large polygons warp a lot.",
  changelog_md: "",
  code: "shader_type spatial;",
  code_language: "gdshader",
  source_url: null,
  tested_at: "2026-10-17T12:00:00Z",
  tested_notes: null,
  url: "https://lowpo11y.test/shaders/affine-warp",
  publishedAt: new Date("2026-10-17T12:00:00Z"),
};

describe("shader bundles", () => {
  it("are byte-identical for the same input", () => {
    expect(buildShaderBundle(shader, MIT)).toEqual(buildShaderBundle(shader, MIT));
  });

  it("hold the code, a README and the licence, skipping empty sections", () => {
    const files = unzipSync(buildShaderBundle(shader, MIT));
    expect(Object.keys(files).sort()).toEqual(["affine-warp/LICENSE.txt", "affine-warp/README.md", "affine-warp/affine-warp.gdshader"]);
    const readme = new TextDecoder().decode(files["affine-warp/README.md"]);
    expect(readme).toContain("Tested with Godot 4.2–4.3 (Forward+) on 2026-10-17.");
    expect(readme).toContain("## Limitations");
    expect(readme).not.toContain("## Setup");
    expect(new TextDecoder().decode(files["affine-warp/affine-warp.gdshader"])).toBe("shader_type spatial;\n");
  });

  it("describe what they were tested with", () => {
    expect(testedLine({ ...shader, engine_version_max: null, renderer_compatibility: null, tested_notes: "WebGL2 in Chrome" })).toBe("Tested with Godot 4.2 on 2026-10-17 — WebGL2 in Chrome");
    expect(codeExtension(null)).toBe("txt");
  });
});
