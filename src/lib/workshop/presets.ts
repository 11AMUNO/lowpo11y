/**
 * Built-in Workshop presets. They contain step types and settings only (no
 * images). Names describe a look; "inspired" because none reproduces a
 * console's exact hardware output.
 */
import { emptyPipeline, newStep, outputSchema, type Pipeline } from "./pipeline";

export interface PresetInfo {
  id: string;
  name: string;
  description: string;
  build: () => Pipeline;
}

const make = (name: string, steps: Pipeline["steps"], output: Partial<Pipeline["output"]> = {}): Pipeline => ({ ...emptyPipeline(name), steps, output: outputSchema.parse(output) });

export const BUILTIN_PRESETS: PresetInfo[] = [
  {
    id: "psx-dirty-industrial",
    name: "PSX-inspired Dirty Industrial",
    description: "128×128, desaturated with grain, 15-bit colour (5-5-5) with 4×4 ordered dithering. For rusted metal, concrete and grime.",
    build: () =>
      make("PSX-inspired Dirty Industrial", [
        newStep("crop", { mode: "square" }),
        newStep("resize", { mode: "exact", width: 128, height: 128, fit: "crop", sampling: "smooth" }),
        newStep("adjust", { contrast: 15, saturation: -25, grain: 6, seed: 7 }),
        newStep("dither", { r: 5, g: 5, b: 5, dither: "bayer4", strength: 75 }),
      ]),
  },
  {
    id: "pixelated-horror",
    name: "Pixelated Horror",
    description: "64 px long side with nearest sampling, dark and drained of colour, a 12-colour palette with ordered dithering.",
    build: () =>
      make("Pixelated Horror", [
        newStep("resize", { mode: "long", width: 64, sampling: "nearest" }),
        newStep("adjust", { brightness: -20, contrast: 30, saturation: -60, gamma: 0.85 }),
        newStep("palette", { source: "adaptive", colours: 12, dither: "bayer4", strength: 60 }),
      ]),
  },
  {
    id: "n64-soft-palette",
    name: "N64-inspired Soft Palette",
    description: "Small, smoothly filtered textures with soft gradients: 64×64, a 32-colour palette without dithering, then 5-5-5 colour.",
    build: () =>
      make("N64-inspired Soft Palette", [
        newStep("crop", { mode: "square" }),
        newStep("resize", { mode: "exact", width: 64, height: 64, fit: "crop", sampling: "smooth" }),
        newStep("adjust", { saturation: 10, gamma: 1.1 }),
        newStep("palette", { source: "adaptive", colours: 32, dither: "none" }),
        newStep("dither", { r: 5, g: 5, b: 5, dither: "none" }),
      ]),
  },
  {
    id: "ui-sprite-cutout",
    name: "UI Sprite Cutout",
    description: "Hard alpha edges, trimmed to the sprite, 16 colours, 2 px transparent padding with colour bleed so edges stay clean when filtered.",
    build: () =>
      make("UI Sprite Cutout", [
        newStep("alpha", { threshold: 128 }),
        newStep("crop", { mode: "trim" }),
        newStep("palette", { source: "adaptive", colours: 16, dither: "none" }),
        newStep("edge", { padding: 2, fill: "transparent", bleed: true }),
      ]),
  },
  {
    id: "atlas-128-grid",
    name: "Atlas 128 Grid",
    description: "Every image cropped to a 128×128 square and packed into a power-of-two grid atlas with 2 px padding and 1 px extrusion, plus UV JSON.",
    build: () =>
      make("Atlas 128 Grid", [
        newStep("crop", { mode: "square" }),
        newStep("resize", { mode: "exact", width: 128, height: 128, fit: "crop", sampling: "nearest" }),
        newStep("atlas", { method: "grid", columns: 0, padding: 2, extrude: 1, pot: true }),
      ]),
  },
];
