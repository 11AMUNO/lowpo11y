/**
 * Procedural demo textures owned by the LOWPO11Y project (released CC0).
 * Deterministic and seamlessly tileable at their native size. They exist so the
 * catalogue, tools and tests have rights-safe content before owner assets are
 * imported — every seeded record built from them is tagged `demo`.
 */
import { posterizeOrdered } from "@/lib/processing/dither";
import { createImage, hexToRgb, setPixel, type RGB, type RGBAImage } from "@/lib/processing/image";
import { hash2, tileableFbm } from "@/lib/processing/random";

type Recipe = (size: number) => RGBAImage;

export interface DemoTextureDef {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  /** Material subject used for category assignment. */
  category: "brick" | "concrete" | "metal" | "wood" | "floor" | "ground" | "utility";
  hasAlpha: boolean;
  recipe: Recipe;
}

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, f: number): RGB => [c[0] * f, c[1] * f, c[2] * f];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const wrap = (v: number, n: number) => ((v % n) + n) % n;

/** Retro finish: 5 bits per channel (32 levels) with 4×4 ordered dither. */
function finish(img: RGBAImage): RGBAImage {
  return posterizeOrdered(img, 32, 4, 0.9);
}

function paint(size: number, fn: (x: number, y: number, u: number, v: number) => RGB | [number, number, number, number]): RGBAImage {
  const img = createImage(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const c = fn(x, y, x / size, y / size);
      setPixel(img, x, y, c.length === 4 ? [c[0], c[1], c[2], c[3]] : [c[0], c[1], c[2], 255]);
    }
  return img;
}

const brick: Recipe = (size) => {
  const rows = 8;
  const cols = 4;
  const bh = size / rows;
  const bw = size / cols;
  const mortar = Math.max(1, Math.round(size / 64));
  const base = hexToRgb("#8a3f2c");
  const alt = hexToRgb("#a5573a");
  const mortarC = hexToRgb("#8e8678");
  return finish(
    paint(size, (x, y, u, v) => {
      const row = Math.floor(y / bh);
      const offset = row % 2 ? bw / 2 : 0;
      const bx = wrap(x + offset, size);
      const col = Math.floor(bx / bw);
      const inX = bx - col * bw;
      const inY = y - row * bh;
      const grime = tileableFbm(u, v, 4, 4, 11);
      if (inX < mortar || inY < mortar) return shade(mortarC, 0.75 + grime * 0.4);
      const tone = hash2(col, row, 7);
      let c = mix(base, alt, tone);
      // Bevel: lighter top-left edge, darker bottom-right edge.
      if (inY < mortar * 2) c = shade(c, 1.12);
      if (inY > bh - mortar * 2 || inX > bw - mortar * 2) c = shade(c, 0.82);
      const speck = tileableFbm(u, v, 16, 2, 13);
      return shade(c, 0.78 + speck * 0.35 - grime * 0.12);
    }),
  );
};

const concrete: Recipe = (size) => {
  const base = hexToRgb("#8b8a84");
  const panel = size / 2;
  return finish(
    paint(size, (x, y, u, v) => {
      const n = tileableFbm(u, v, 4, 5, 21);
      const stain = clamp01((tileableFbm(u, v, 3, 3, 23) - 0.55) * 4);
      let c = shade(base, 0.72 + n * 0.45);
      c = mix(c, hexToRgb("#5b5850"), stain * 0.55);
      const sx = x % panel;
      const sy = y % panel;
      if (sx === 0 || sy === 0) c = shade(c, 0.55);
      else if (sx === 1 || sy === 1) c = shade(c, 1.15);
      // Form-tie holes, a classic of poured concrete walls.
      const hx = wrap(sx - panel / 4, panel);
      const hy = wrap(sy - panel / 4, panel);
      const tie = (hx === 0 || hx === panel / 2) && (hy === 0 || hy === panel / 2);
      if (tie) c = shade(c, 0.45);
      return c;
    }),
  );
};

const rust: Recipe = (size) => {
  const steel = hexToRgb("#6d7377");
  const rustA = hexToRgb("#7a3b1d");
  const rustB = hexToRgb("#b0612a");
  const plate = size / 2;
  return finish(
    paint(size, (x, y, u, v) => {
      const n = tileableFbm(u, v, 3, 5, 31);
      const r = clamp01((tileableFbm(u, v, 4, 4, 33) - 0.42) * 3.2);
      let c = mix(shade(steel, 0.8 + n * 0.35), mix(rustA, rustB, tileableFbm(u, v, 12, 2, 35)), r);
      const px = x % plate;
      const py = y % plate;
      if (px === 0 || py === 0) c = shade(c, 0.5);
      if (px === 1 || py === 1) c = shade(c, 1.2);
      // Rivets inset from each plate corner.
      const inset = Math.max(3, Math.round(plate / 8));
      for (const [rx, ry] of [
        [inset, inset],
        [plate - inset, inset],
        [inset, plate - inset],
        [plate - inset, plate - inset],
      ] as const) {
        const d = Math.hypot(px - rx, py - ry);
        if (d < 1.6) c = shade(steel, d < 0.8 ? 1.35 : 1.05);
        else if (d < 2.3) c = shade(c, 0.6);
      }
      return c;
    }),
  );
};

const tread: Recipe = (size) => {
  const steel = hexToRgb("#7f8589");
  const cell = size / 8;
  return finish(
    paint(size, (x, y, u, v) => {
      const n = tileableFbm(u, v, 6, 3, 41);
      let c = shade(steel, 0.7 + n * 0.3);
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      const lx = (x % cell) / cell - 0.5;
      const ly = (y % cell) / cell - 0.5;
      // Alternate raised diamond orientation per cell (classic tread plate).
      const flip = (cx + cy) % 2 === 0;
      const a = flip ? lx + ly : lx - ly;
      const b = flip ? lx - ly : lx + ly;
      if (Math.abs(a) < 0.12 && Math.abs(b) < 0.44) c = shade(steel, b < 0 ? 1.3 : 0.72);
      const wear = clamp01((tileableFbm(u, v, 2, 3, 43) - 0.5) * 3);
      return mix(c, hexToRgb("#a9a395"), wear * 0.25);
    }),
  );
};

const wood: Recipe = (size) => {
  const planks = 4;
  const pw = size / planks;
  const dark = hexToRgb("#4f3420");
  const light = hexToRgb("#8a603b");
  return finish(
    paint(size, (x, y, u, v) => {
      const p = Math.floor(x / pw);
      const tone = hash2(p, 0, 51);
      const grain = tileableFbm(u, v, 2, 3, 53 + p);
      const streak = tileableFbm(u, v, 16, 2, 59 + p);
      const rings = 0.5 + 0.5 * Math.sin((u * planks * 5 + grain * 1.6 + tone * 3) * Math.PI * 2);
      let c = mix(dark, light, 0.3 + rings * 0.3 + tone * 0.22 + (streak - 0.5) * 0.25);
      const lx = x % pw;
      if (lx === 0) c = shade(c, 0.4);
      else if (lx === 1) c = shade(c, 1.15);
      // Butt joints at a different height on each plank.
      const joint = Math.floor(hash2(p, 1, 57) * size);
      if (y === joint) c = shade(c, 0.45);
      // Nails either side of the joint.
      if ((Math.abs(y - wrap(joint + 3, size)) < 1 || Math.abs(y - wrap(joint - 3, size)) < 1) && (lx === 4 || lx === pw - 5))
        c = hexToRgb("#2b2622");
      return c;
    }),
  );
};

const tiles: Recipe = (size) => {
  const t = size / 4;
  const a = hexToRgb("#c9c2ad");
  const b = hexToRgb("#a9a28c");
  const grout = hexToRgb("#5f5a4e");
  return finish(
    paint(size, (x, y, u, v) => {
      const tx = Math.floor(x / t);
      const ty = Math.floor(y / t);
      const lx = x % t;
      const ly = y % t;
      const grime = tileableFbm(u, v, 3, 4, 61);
      if (lx < 2 || ly < 2) return shade(grout, 0.8 + grime * 0.3);
      let c = (tx + ty) % 2 ? a : b;
      c = shade(c, 0.85 + hash2(tx, ty, 63) * 0.12 - grime * 0.18);
      if (lx === 2 || ly === 2) c = shade(c, 1.1);
      // A short hairline crack on roughly one tile in ten.
      const crackLen = t * (0.3 + hash2(tx, ty, 69) * 0.4);
      const crack = hash2(tx, ty, 65) > 0.9 && lx < crackLen + 2 && Math.abs(lx - ly * 0.6 - (t / 3) * hash2(tx, ty, 67)) < 0.7;
      return crack ? shade(c, 0.55) : c;
    }),
  );
};

const hazard: Recipe = (size) => {
  const period = size / 4;
  const yellow = hexToRgb("#d6a722");
  const black = hexToRgb("#22201d");
  return finish(
    paint(size, (x, y, u, v) => {
      const s = wrap(x + y, period) < period / 2;
      const wear = clamp01((tileableFbm(u, v, 5, 4, 71) - 0.58) * 4);
      const base = s ? yellow : black;
      const n = tileableFbm(u, v, 16, 2, 73);
      return mix(shade(base, 0.85 + n * 0.25), hexToRgb("#6c6a63"), wear * 0.7);
    }),
  );
};

const grass: Recipe = (size) => {
  const g1 = hexToRgb("#3f5a2a");
  const g2 = hexToRgb("#6b7f37");
  const dirt = hexToRgb("#6a5236");
  return finish(
    paint(size, (x, y, u, v) => {
      const n = tileableFbm(u, v, 8, 3, 81);
      const patch = clamp01((tileableFbm(u, v, 3, 4, 83) - 0.56) * 5);
      const blade = hash2(x, y, 85) > 0.86 ? 1.25 : 1;
      return mix(shade(mix(g1, g2, n), blade), shade(dirt, 0.8 + n * 0.4), patch);
    }),
  );
};

const cobble: Recipe = (size) => {
  // Tileable Voronoi: feature points live on a wrapped grid.
  const cells = 6;
  const cs = size / cells;
  const pts: [number, number][][] = [];
  for (let j = 0; j < cells; j++) {
    pts[j] = [];
    for (let i = 0; i < cells; i++) pts[j]![i] = [(i + 0.2 + hash2(i, j, 91) * 0.6) * cs, (j + 0.2 + hash2(i, j, 93) * 0.6) * cs];
  }
  const stone = hexToRgb("#7d776c");
  return finish(
    paint(size, (x, y, u, v) => {
      let d1 = Infinity;
      let d2 = Infinity;
      let id = 0;
      const ci = Math.floor(x / cs);
      const cj = Math.floor(y / cs);
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          const i = ci + di;
          const j = cj + dj;
          const p = pts[wrap(j, cells)]![wrap(i, cells)]!;
          const px = p[0] + Math.floor(i / cells) * size;
          const py = p[1] + Math.floor(j / cells) * size;
          const d = Math.hypot(x + 0.5 - px, y + 0.5 - py);
          if (d < d1) {
            d2 = d1;
            d1 = d;
            id = wrap(i, cells) + wrap(j, cells) * cells;
          } else if (d < d2) d2 = d;
        }
      const edge = d2 - d1;
      const n = tileableFbm(u, v, 8, 3, 95);
      if (edge < 1.6) return shade(hexToRgb("#3d3a35"), 0.9 + n * 0.3);
      const tone = hash2(id, 0, 97);
      const c = shade(stone, 0.72 + tone * 0.3 + n * 0.2);
      return edge < 3 ? shade(c, 0.82) : c;
    }),
  );
};

const uvChecker: Recipe = (size) => {
  const cells = 8;
  const cs = size / cells;
  return paint(size, (x, y) => {
    const cx = Math.floor(x / cs);
    const cy = Math.floor(y / cs);
    const lx = x % cs;
    const ly = y % cs;
    const hue = (cx / cells) * 300;
    const light = (cx + cy) % 2 ? 0.62 : 0.38;
    const c = hslToRgb(hue, 0.55, light - (cy / cells) * 0.12);
    if (lx === 0 || ly === 0) return [30, 28, 25];
    // Small arrow in the top-left of every cell showing +U/+V direction.
    if (ly === 2 && lx >= 2 && lx < Math.min(cs - 2, 8)) return [235, 230, 214];
    if (lx === 2 && ly >= 2 && ly < Math.min(cs - 2, 6)) return [235, 230, 214];
    return c;
  });
};

const grate: Recipe = (size) => {
  const cell = size / 8;
  const bar = Math.max(2, Math.round(cell / 4));
  const steel = hexToRgb("#5d6266");
  return finish(
    paint(size, (x, y, u, v) => {
      const lx = x % cell;
      const ly = y % cell;
      const onBar = lx < bar || ly < bar;
      if (!onBar) return [0, 0, 0, 0];
      const n = tileableFbm(u, v, 6, 3, 101);
      const lit = lx === 0 || ly === 0 ? 1.25 : lx === bar - 1 || ly === bar - 1 ? 0.7 : 1;
      const r = clamp01((tileableFbm(u, v, 4, 3, 103) - 0.6) * 4);
      return [...mix(shade(steel, (0.8 + n * 0.3) * lit), hexToRgb("#8a4a24"), r * 0.6), 255] as [number, number, number, number];
    }),
  );
};

function hslToRgb(h: number, s: number, l: number): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

export const DEMO_TEXTURES: DemoTextureDef[] = [
  { slug: "demo-red-brick", title: "Red brick wall", description: "Running-bond brick with recessed mortar and light grime.", tags: ["brick", "wall", "urban", "exterior"], category: "brick", hasAlpha: false, recipe: brick },
  { slug: "demo-poured-concrete", title: "Poured concrete panels", description: "Board-formed concrete panels with seams, stains and form-tie holes.", tags: ["concrete", "wall", "brutalist", "industrial"], category: "concrete", hasAlpha: false, recipe: concrete },
  { slug: "demo-rusted-plate", title: "Rusted steel plate", description: "Riveted steel plates with spreading rust.", tags: ["metal", "rust", "industrial", "derelict"], category: "metal", hasAlpha: false, recipe: rust },
  { slug: "demo-tread-plate", title: "Steel tread plate", description: "Raised diamond floor plate with worn highlights.", tags: ["metal", "floor", "industrial", "sci-fi"], category: "metal", hasAlpha: false, recipe: tread },
  { slug: "demo-wood-planks", title: "Wood floor planks", description: "Four planks per tile with staggered butt joints and nails.", tags: ["wood", "floor", "domestic", "horror"], category: "wood", hasAlpha: false, recipe: wood },
  { slug: "demo-checker-tiles", title: "Checker floor tiles", description: "Two-tone ceramic tiles with dark grout and the odd crack.", tags: ["tiles", "floor", "domestic", "interior"], category: "floor", hasAlpha: false, recipe: tiles },
  { slug: "demo-hazard-stripes", title: "Worn hazard stripes", description: "Diagonal warning stripes with scuffed paint.", tags: ["hazard", "decal", "industrial", "signage"], category: "utility", hasAlpha: false, recipe: hazard },
  { slug: "demo-patchy-grass", title: "Patchy grass", description: "Short grass with bare dirt patches.", tags: ["grass", "ground", "nature", "exterior"], category: "ground", hasAlpha: false, recipe: grass },
  { slug: "demo-cobblestones", title: "Cobblestones", description: "Irregular stones from a seamless Voronoi layout.", tags: ["stone", "ground", "street", "exterior"], category: "ground", hasAlpha: false, recipe: cobble },
  { slug: "demo-uv-checker", title: "UV test grid", description: "Coloured checker with +U/+V markers for spotting stretched or flipped UVs.", tags: ["uv", "checker", "utility", "test"], category: "utility", hasAlpha: false, recipe: uvChecker },
  { slug: "demo-steel-grate", title: "Steel floor grate (alpha)", description: "Square-mesh grate with transparent holes — for cutout materials.", tags: ["metal", "grate", "alpha", "industrial"], category: "metal", hasAlpha: true, recipe: grate },
];

export function renderDemoTexture(slug: string, size = 128): RGBAImage {
  const def = DEMO_TEXTURES.find((t) => t.slug === slug);
  if (!def) throw new Error(`Unknown demo texture ${slug}`);
  return def.recipe(size);
}
