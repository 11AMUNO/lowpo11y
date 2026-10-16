/**
 * Procedural demo props owned by LOWPO11Y (CC0), built from primitives and
 * textured with the demo textures. Units are metres; pivots sit at the base
 * centre so props drop onto a floor at y = 0.
 */
import sharp from "sharp";
import { box, cylinder, extrude, frustum, merge, type Geometry } from "@/lib/formats/geometry";
import { writeGlb, type ImageInput, type MaterialInput, type MeshInput, type NodeInput } from "@/lib/formats/glb-writer";
import { renderDemoTexture } from "./textures";

export interface DemoModelDef {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  category: "props" | "architecture" | "electronics" | "street";
  build: () => Promise<Uint8Array>;
}

async function png(slug: string, size = 128): Promise<Uint8Array> {
  const img = renderDemoTexture(slug, size);
  return new Uint8Array(await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer());
}

interface Part {
  geometry: Geometry;
  material: number;
}

async function model(parts: Part[], materials: (MaterialInput & { textureSlug?: string })[]): Promise<Uint8Array> {
  const images: ImageInput[] = [];
  const texIndex = new Map<string, number>();
  const mats: MaterialInput[] = [];
  for (const m of materials) {
    let texture: number | undefined;
    if (m.textureSlug) {
      if (!texIndex.has(m.textureSlug)) {
        images.push({ name: `${m.textureSlug}.png`, mimeType: "image/png", data: await png(m.textureSlug) });
        texIndex.set(m.textureSlug, images.length - 1);
      }
      texture = texIndex.get(m.textureSlug);
    }
    const { textureSlug: _t, ...rest } = m;
    mats.push({ ...rest, texture, nearest: true });
  }
  // One primitive per material keeps draw calls low.
  const byMat = new Map<number, Geometry[]>();
  for (const p of parts) byMat.set(p.material, [...(byMat.get(p.material) ?? []), p.geometry]);
  const meshes: MeshInput[] = [{ name: "prop", primitives: [...byMat.entries()].map(([material, gs]) => ({ ...merge(...gs), material })) }];
  const nodes: NodeInput[] = [{ name: "prop", mesh: 0 }];
  return writeGlb({ meshes, materials: mats, images, nodes, roots: [0], generator: "LOWPO11Y demo props", copyright: "LOWPO11Y demo content, CC0 1.0" });
}

const wood = { name: "wood", textureSlug: "demo-wood-planks" };
const rust = { name: "rusted steel", textureSlug: "demo-rusted-plate" };
const concrete = { name: "concrete", textureSlug: "demo-poured-concrete" };
const tread = { name: "tread plate", textureSlug: "demo-tread-plate" };
const brick = { name: "brick", textureSlug: "demo-red-brick" };
const hazard = { name: "hazard paint", textureSlug: "demo-hazard-stripes" };
const plastic = (name: string, rgb: [number, number, number]) => ({ name, baseColor: [...rgb, 1] as [number, number, number, number] });

export const DEMO_MODELS: DemoModelDef[] = [
  {
    slug: "demo-wooden-crate",
    title: "Wooden crate",
    description: "A 1 m plank crate with corner battens. 12 faces of texture-mapped boxes, pivot at the base.",
    tags: ["crate", "wood", "storage", "industrial", "psx-inspired"],
    category: "props",
    build: () =>
      model(
        [
          { geometry: box(0.96, 0.96, 0.96, 0, 0.5, 0), material: 0 },
          ...[-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({ geometry: box(0.1, 1, 0.1, sx * 0.45, 0.5, sz * 0.45), material: 1 }))),
        ],
        [wood, plastic("battens", [0.36, 0.25, 0.16])],
      ),
  },
  {
    slug: "demo-oil-drum",
    title: "Rusted oil drum",
    description: "A 10-sided 200 L drum with raised rims. Rust texture wraps once around the body.",
    tags: ["barrel", "drum", "rust", "industrial", "derelict", "psx-inspired"],
    category: "props",
    build: () =>
      model(
        [
          { geometry: cylinder(0.29, 0.88, 10, 0, 0, 0), material: 0 },
          { geometry: cylinder(0.3, 0.04, 10, 0, 0.29, 0, false), material: 1 },
          { geometry: cylinder(0.3, 0.04, 10, 0, 0.59, 0, false), material: 1 },
        ],
        [rust, plastic("rim", [0.32, 0.18, 0.1])],
      ),
  },
  {
    slug: "demo-jersey-barrier",
    title: "Concrete jersey barrier",
    description: "A 2 m road barrier with the classic stepped profile, extruded and UV-mapped at 1 m per tile.",
    tags: ["barrier", "concrete", "road", "urban", "brutalist", "psx-inspired"],
    category: "street",
    build: () =>
      model(
        [
          {
            geometry: extrude(
              [
                [-0.3, 0],
                [0.3, 0],
                [0.3, 0.08],
                [0.12, 0.3],
                [0.08, 0.81],
                [-0.08, 0.81],
                [-0.12, 0.3],
                [-0.3, 0.08],
              ],
              2,
            ),
            material: 0,
          },
        ],
        [concrete],
      ),
  },
  {
    slug: "demo-crt-monitor",
    title: "CRT monitor",
    description: "A deep-bodied CRT with a recessed screen and stand, flat-coloured for palette swaps.",
    tags: ["crt", "monitor", "electronics", "computer", "domestic"],
    category: "electronics",
    build: () =>
      model(
        [
          { geometry: box(0.44, 0.36, 0.4, 0, 0.26, -0.02), material: 0 },
          { geometry: box(0.36, 0.28, 0.02, 0, 0.27, 0.185), material: 1 },
          { geometry: box(0.2, 0.06, 0.2, 0, 0.03, 0), material: 0 },
          { geometry: box(0.06, 0.02, 0.01, 0.15, 0.09, 0.185), material: 2 },
        ],
        [plastic("beige case", [0.78, 0.74, 0.64]), plastic("screen", [0.08, 0.14, 0.12]), plastic("power led", [0.2, 0.9, 0.3])],
      ),
  },
  {
    slug: "demo-street-lamp",
    title: "Street lamp",
    description: "A 4 m sodium street lamp: octagonal pole, arm and lamp head with an emissive lens.",
    tags: ["lamp", "street", "urban", "light", "psx-inspired"],
    category: "street",
    build: () =>
      model(
        [
          { geometry: frustum(0.09, 0.06, 4, 8), material: 0 },
          { geometry: box(0.9, 0.06, 0.08, 0.42, 3.95, 0), material: 0 },
          { geometry: box(0.36, 0.1, 0.2, 0.86, 3.9, 0), material: 0 },
          { geometry: box(0.3, 0.02, 0.16, 0.86, 3.84, 0), material: 1 },
          { geometry: cylinder(0.16, 0.2, 8, 0, 0, 0), material: 0 },
        ],
        [plastic("painted steel", [0.27, 0.3, 0.28]), { name: "lens", baseColor: [1, 0.72, 0.3, 1], emissive: [1, 0.62, 0.22], unlit: true }],
      ),
  },
  {
    slug: "demo-wooden-pallet",
    title: "Wooden pallet",
    description: "A 1.2 × 0.8 m pallet: deck boards on three runners. Under 100 triangles.",
    tags: ["pallet", "wood", "warehouse", "industrial"],
    category: "props",
    build: () =>
      model(
        [
          ...[-0.5, -0.25, 0, 0.25, 0.5].map((x) => ({ geometry: box(0.14, 0.022, 0.8, x, 0.133, 0), material: 0 })),
          ...[-0.36, 0, 0.36].map((z) => ({ geometry: box(1.2, 0.1, 0.1, 0, 0.072, z), material: 0 })),
          ...[-0.5, 0, 0.5].map((x) => ({ geometry: box(0.14, 0.022, 0.8, x, 0.011, 0), material: 0 })),
        ],
        [wood],
      ),
  },
  {
    slug: "demo-brick-wall-module",
    title: "Brick wall module 2 m",
    description: "A 2 × 2.5 m wall module, 0.2 m thick, on a 0.5 m grid. Texture tiles once per metre.",
    tags: ["wall", "brick", "modular", "urban", "architecture"],
    category: "architecture",
    build: () => model([{ geometry: box(2, 2.5, 0.2, 0, 1.25, 0, 1), material: 0 }], [brick]),
  },
  {
    slug: "demo-tread-floor-module",
    title: "Tread-plate floor module 2 m",
    description: "A 2 × 2 m floor tile, 5 cm thick, with tread plate tiling once per metre.",
    tags: ["floor", "metal", "modular", "industrial", "sci-fi"],
    category: "architecture",
    build: () => model([{ geometry: box(2, 0.05, 2, 0, 0.025, 0, 1), material: 0 }], [tread]),
  },
  {
    slug: "demo-traffic-cone",
    title: "Traffic cone",
    description: "An 8-sided cone with a square base. 30 triangles.",
    tags: ["cone", "road", "urban", "hazard"],
    category: "street",
    build: () =>
      model(
        [
          { geometry: frustum(0.16, 0.02, 0.7, 8, 0, 0.03, 0), material: 0 },
          { geometry: box(0.4, 0.03, 0.4, 0, 0.015, 0), material: 1 },
        ],
        [plastic("orange plastic", [0.95, 0.38, 0.08]), plastic("rubber base", [0.12, 0.12, 0.12])],
      ),
  },
  {
    slug: "demo-hazard-locker",
    title: "Hazard storage locker",
    description: "A 0.6 × 1.8 m steel locker with a hazard-striped kick plate.",
    tags: ["locker", "storage", "industrial", "hazard"],
    category: "props",
    build: () =>
      model(
        [
          { geometry: box(0.6, 1.62, 0.5, 0, 0.99, 0), material: 0 },
          { geometry: box(0.6, 0.18, 0.5, 0, 0.09, 0), material: 1 },
          { geometry: box(0.03, 0.2, 0.02, 0.22, 1.05, 0.26), material: 2 },
        ],
        [rust, hazard, plastic("handle", [0.15, 0.15, 0.15])],
      ),
  },
];
