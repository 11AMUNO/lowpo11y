import { describe, expect, it } from "vitest";
import { buildAtlasDoc, frameUv, parseAtlasJson, toAtlasCsv, toAtlasJson, validateAtlas, type AtlasFrame } from "@/lib/formats/atlas-json";
import { compose, flatten, MAX_ATLAS, pack, PACK_DEFAULTS, rotate, trimTransparent, type PackSettings } from "./atlas";
import { createImage, getPixel, isPowerOfTwo, setPixel, type RGBAImage } from "./image";
import { mulberry32 } from "./random";

/** A tile whose every pixel is unique to (tile, x, y), with an optional transparent margin. */
function tile(id: number, w: number, h: number, margin = 0): RGBAImage {
  const img = createImage(w, h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x >= margin && y >= margin && x < w - margin && y < h - margin;
      setPixel(img, x, y, [(id * 37 + x * 5) % 256, (id * 11 + y * 7) % 256, (x * y + id) % 256, inside ? 255 : 0]);
    }
  return img;
}

function build(tiles: RGBAImage[], s: Partial<PackSettings>) {
  const settings = { ...PACK_DEFAULTS, ...s };
  const r = pack(tiles.map((t) => ({ w: t.width, h: t.height })), settings);
  const atlas = compose(tiles, r, settings.extrude);
  const frames: AtlasFrame[] = r.placements.map((p) => ({ name: `t${p.index}`, x: p.x, y: p.y, w: p.w, h: p.h, rotated: p.rotated, sourceW: tiles[p.index]!.width, sourceH: tiles[p.index]!.height }));
  const doc = buildAtlasDoc({ image: "atlas.png", width: r.width, height: r.height, uvOrigin: "bottom-left", uvInset: 0, padding: settings.padding, extrude: settings.extrude, frames });
  return { r, atlas, doc, map: new Map(tiles.map((t, i) => [`t${i}`, t])) };
}

const randomTiles = (seed: number, n: number) => {
  const rnd = mulberry32(seed);
  return Array.from({ length: n }, (_, i) => tile(i, 4 + Math.floor(rnd() * 60), 4 + Math.floor(rnd() * 60)));
};

describe("tile edits", () => {
  it("rotates clockwise and back", () => {
    const t = tile(1, 5, 3);
    const r = rotate(t, 90);
    expect([r.width, r.height]).toEqual([3, 5]);
    expect(getPixel(r, 2, 0)).toEqual(getPixel(t, 0, 0)); // top-left goes to top-right
    expect(rotate(rotate(rotate(r, 90), 90), 90).data).toEqual(t.data);
    expect(rotate(rotate(t, 180), 180).data).toEqual(t.data);
  });

  it("trims transparent borders and flattens onto a colour", () => {
    const t = trimTransparent(tile(2, 10, 8, 2));
    expect([t.width, t.height]).toEqual([6, 4]);
    expect([...trimTransparent(createImage(4, 4)).data]).toEqual([0, 0, 0, 0]);
    const f = flatten(tile(3, 4, 4, 1), [10, 20, 30]);
    expect(getPixel(f, 0, 0)).toEqual([10, 20, 30, 255]);
  });
});

describe("pack + compose", () => {
  const variants: Partial<PackSettings>[] = [
    {},
    { method: "grid" },
    { method: "grid", columns: 3, pot: false },
    { pot: false },
    { pot: false, square: true },
    { square: true },
    { allowRotate: true },
    { padding: 0, extrude: 0 },
    { padding: 4, extrude: 2, border: 3 },
    { extrude: 4, padding: 1, allowRotate: true, pot: false },
  ];

  it("never overlaps, keeps every tile's pixels exactly, and UVs match the rects", () => {
    for (const seed of [1, 2, 3])
      for (const v of variants) {
        const tiles = randomTiles(seed, 6 + seed * 5);
        const { r, atlas, doc, map } = build(tiles, v);
        expect(r.overflow, JSON.stringify(v)).toEqual([]);
        expect(r.placements).toHaveLength(tiles.length);
        expect(validateAtlas(doc, atlas, map), JSON.stringify(v)).toEqual([]);
        if (v.pot !== false && (v.size ?? "auto") === "auto") expect(isPowerOfTwo(r.width) && isPowerOfTwo(r.height)).toBe(true);
        if (v.square) expect(r.width).toBe(r.height);
      }
  });

  it("is deterministic", () => {
    const a = build(randomTiles(9, 20), { allowRotate: true });
    const b = build(randomTiles(9, 20), { allowRotate: true });
    expect(a.r).toEqual(b.r);
    expect(a.atlas.data).toEqual(b.atlas.data);
  });

  it("extrudes edge pixels and leaves padding transparent", () => {
    const tiles = [tile(1, 8, 8), tile(2, 8, 8)];
    const { r, atlas } = build(tiles, { method: "grid", columns: 2, padding: 2, extrude: 2, border: 0, pot: false });
    const [a, b] = r.placements;
    // left of tile a's content: copies of its left column, two pixels deep
    expect(getPixel(atlas, a!.x - 1, a!.y + 3)).toEqual(getPixel(tiles[0]!, 0, 3));
    expect(getPixel(atlas, a!.x - 2, a!.y + 3)).toEqual(getPixel(tiles[0]!, 0, 3));
    // corners copy the corner pixel
    expect(getPixel(atlas, a!.x - 2, a!.y - 2)).toEqual(getPixel(tiles[0]!, 0, 0));
    // gap between a's extrusion and b's extrusion is exactly `padding` transparent pixels
    const gapStart = a!.x + a!.w + 2;
    expect(b!.x - 2 - gapStart).toBe(2);
    for (let x = gapStart; x < b!.x - 2; x++) expect(getPixel(atlas, x, a!.y)[3]).toBe(0);
  });

  it("rotates tiles only when allowed, and stores them turned clockwise", () => {
    const tall = [tile(1, 10, 60), tile(2, 10, 60), tile(3, 60, 10), tile(4, 60, 10)];
    const noRot = build(tall, { pot: false });
    expect(noRot.r.placements.every((p) => !p.rotated)).toBe(true);
    const rot = build(tall, { allowRotate: true, pot: false, square: true });
    expect(validateAtlas(rot.doc, rot.atlas, rot.map)).toEqual([]);
    for (const p of rot.r.placements) if (p.rotated) expect([p.w, p.h]).toEqual([tall[p.index]!.height, tall[p.index]!.width]);
  });

  it("reports overflow clearly for a manual size that's too small", () => {
    const tiles = Array.from({ length: 10 }, (_, i) => tile(i, 32, 32));
    const r = pack(tiles.map((t) => ({ w: t.width, h: t.height })), { ...PACK_DEFAULTS, size: "manual", width: 64, height: 64, padding: 0, extrude: 0 });
    expect([r.width, r.height]).toEqual([64, 64]);
    expect(r.placements).toHaveLength(4);
    expect(r.overflow).toEqual([4, 5, 6, 7, 8, 9]);
    const g = pack(tiles.map((t) => ({ w: t.width, h: t.height })), { ...PACK_DEFAULTS, method: "grid", size: "manual", width: 64, height: 64, padding: 0, extrude: 0 });
    expect(g.placements).toHaveLength(4);
    expect(g.overflow).toHaveLength(6);
    // larger than the biggest atlas
    expect(pack([{ w: MAX_ATLAS + 1, h: 4 }], PACK_DEFAULTS).overflow).toEqual([0]);
  });
});

describe("atlas metadata", () => {
  it("UVs for both origins and insets", () => {
    const f = { x: 16, y: 0, w: 16, h: 32 };
    expect(frameUv(f, 64, 64, "top-left")).toEqual({ u0: 0.25, v0: 0, u1: 0.5, v1: 0.5 });
    expect(frameUv(f, 64, 64, "bottom-left")).toEqual({ u0: 0.25, v0: 0.5, u1: 0.5, v1: 1 });
    expect(frameUv(f, 64, 64, "top-left", 0.5)).toEqual({ u0: 16.5 / 64, v0: 0.5 / 64, u1: 31.5 / 64, v1: 31.5 / 64 });
  });

  it("JSON round-trips, CSV has one row per frame, and the validator catches tampering", () => {
    const { atlas, doc, map } = build(randomTiles(4, 8), {});
    const back = parseAtlasJson(toAtlasJson(doc));
    expect(back).toEqual(doc);
    const csv = toAtlasCsv(doc).trim().split("\n");
    expect(csv[0]).toBe("name,x,y,w,h,rotated,source_w,source_h,u0,v0,u1,v1");
    expect(csv).toHaveLength(doc.frames.length + 1);
    const moved = { ...doc, frames: doc.frames.map((f, i) => (i === 0 ? { ...f, x: f.x + 1 } : f)) };
    expect(validateAtlas(moved, atlas, map).join(" ")).toMatch(/u0|differ/);
    const overlap = { ...doc, frames: doc.frames.map((f, i) => (i === 1 ? { ...f, x: doc.frames[0]!.x, y: doc.frames[0]!.y } : f)) };
    expect(validateAtlas(overlap, atlas).join(" ")).toMatch(/overlaps/);
    expect(() => parseAtlasJson('{"format":"other"}')).toThrow(/Not a LOWPO11Y atlas/);
  });
});
