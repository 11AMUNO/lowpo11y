/**
 * Code-side registry of browser tools. The `tools` table can override
 * `enabled`/`featured` per tool from the CMS; everything else is defined here
 * because each tool is code.
 *
 * `status` is honest: "available" tools are implemented and tested;
 * "in-development" tools are listed without links.
 */
export type ToolStatus = "available" | "in-development";
export type ToolCategory = "texture" | "colour" | "model" | "type" | "pipeline";

export interface ToolDefinition {
  slug: string;
  name: string;
  summary: string;
  route: string;
  category: ToolCategory;
  status: ToolStatus;
  /** Where processing happens. All launch tools are local-only. */
  processing: "local";
  version: string;
}

export const TOOLS: ToolDefinition[] = [
  {
    slug: "seamless",
    name: "Seamless texture",
    summary: "Make textures tile cleanly with offset blending, mirror or edge healing, black-to-transparent and PSX palettes, then batch-export a ZIP.",
    route: "/tools/seamless",
    category: "texture",
    status: "available",
    processing: "local",
    version: "2.0.0",
  },
  {
    slug: "texture-converter",
    name: "Retro texture converter",
    summary: "Downscale, quantise and dither textures to a PS1-era look with exact output sizes and palette control.",
    route: "/tools/texture-converter",
    category: "texture",
    status: "available",
    processing: "local",
    version: "1.0.0",
  },
  {
    slug: "resizer",
    name: "Batch resizer",
    summary: "Resize a folder of textures by long side, exact size or percentage, round to powers of two, and download a ZIP that keeps your folders.",
    route: "/tools/resizer",
    category: "texture",
    status: "available",
    processing: "local",
    version: "1.0.0",
  },
  {
    slug: "texture-atlas",
    name: "Texture atlas builder",
    summary: "Pack tiles into one atlas with gutters and edge extrusion, then export the PNG with UV mapping JSON.",
    route: "/tools/texture-atlas",
    category: "texture",
    status: "in-development",
    processing: "local",
    version: "0.0.0",
  },
  {
    slug: "palette",
    name: "Palette generator",
    summary: "Extract a palette from a reference image, edit and lock colours, and export GPL, JSON or PNG swatches.",
    route: "/tools/palette",
    category: "colour",
    status: "in-development",
    processing: "local",
    version: "0.0.0",
  },
  {
    slug: "model-inspector",
    name: "Model inspector",
    summary: "Open a GLB or glTF to check triangles, materials, texture sizes, UVs and animations — nothing is uploaded.",
    route: "/tools/model-inspector",
    category: "model",
    status: "in-development",
    processing: "local",
    version: "0.0.0",
  },
  {
    slug: "bitmap-font",
    name: "Bitmap font generator",
    summary: "Turn a licensed TTF or OTF into a pixel font atlas with BMFont metrics for your engine.",
    route: "/tools/bitmap-font",
    category: "type",
    status: "in-development",
    processing: "local",
    version: "0.0.0",
  },
  {
    slug: "decal",
    name: "Decal and cutout maker",
    summary: "Key out a background by colour or brightness, refine the edge, and save a transparent PNG decal.",
    route: "/tools/decal",
    category: "texture",
    status: "in-development",
    processing: "local",
    version: "0.0.0",
  },
];

export const TOOL_CATEGORY_LABEL: Record<ToolCategory, string> = {
  texture: "Textures",
  colour: "Colour",
  model: "Models",
  type: "Type",
  pipeline: "Pipelines",
};

export function getTool(slug: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
