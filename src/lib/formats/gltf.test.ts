import { describe, expect, it } from "vitest";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { box, cylinder, merge } from "./geometry";
import { writeGlb } from "./glb-writer";
import { gltfStats, GltfError, parseGlb, parseGltfJson } from "./gltf";

// 1×1 transparent PNG
const PNG_1x1 = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

function sampleGlb() {
  const crate = box(1, 1, 1, 0, 0.5, 0);
  const pole = cylinder(0.1, 2, 6);
  return writeGlb({
    meshes: [
      { name: "crate", primitives: [{ ...crate, material: 0 }] },
      { name: "pole", primitives: [{ ...merge(pole), material: 1 }] },
    ],
    materials: [{ name: "wood", texture: 0, nearest: true }, { name: "steel", baseColor: [0.5, 0.5, 0.55, 1] }],
    images: [{ name: "wood.png", mimeType: "image/png", data: PNG_1x1 }],
    nodes: [
      { name: "root", children: [1, 2, 3] },
      { name: "crate-a", mesh: 0, translation: [-1, 0, 0] },
      { name: "crate-b", mesh: 0, translation: [1, 0, 0], scale: [2, 2, 2] },
      { name: "pole", mesh: 1 },
    ],
    roots: [0],
  });
}

describe("writeGlb + gltfStats", () => {
  it("writes a valid GLB with 4-byte aligned chunks", () => {
    const glb = sampleGlb();
    expect(glb.byteLength % 4).toBe(0);
    const dv = new DataView(glb.buffer);
    expect(dv.getUint32(0, true)).toBe(0x46546c67);
    expect(dv.getUint32(8, true)).toBe(glb.byteLength);
  });

  it("counts unique vs instanced triangles and draw calls", () => {
    const stats = gltfStats(parseGlb(sampleGlb()));
    const poleTris = 6 * 2 + 6 * 2; // sides + two caps
    expect(stats.uniqueTriangles).toBe(12 + poleTris);
    expect(stats.sceneTriangles).toBe(12 * 2 + poleTris);
    expect(stats.drawCalls).toBe(3);
    expect(stats.meshes).toBe(2);
    expect(stats.materials).toBe(2);
    expect(stats.uvChannels).toBe(1);
    expect(stats.hasNormals).toBe(true);
  });

  it("computes world-space bounds through node transforms", () => {
    const stats = gltfStats(parseGlb(sampleGlb()));
    // crate-b: scaled 2× at x=1 → spans x 0..2, y 0..2
    expect(stats.bounds?.max[0]).toBeCloseTo(2);
    expect(stats.bounds?.min[0]).toBeCloseTo(-1.5);
    expect(stats.bounds?.max[1]).toBeCloseTo(2);
    expect(stats.bounds?.min[1]).toBeCloseTo(0);
  });

  it("reads embedded image sizes", () => {
    const stats = gltfStats(parseGlb(sampleGlb()));
    expect(stats.images).toEqual([expect.objectContaining({ name: "wood.png", width: 1, height: 1, mimeType: "image/png", external: false })]);
  });

  it("is accepted by three.js GLTFLoader", async () => {
    // Images need a DOM to decode, so validate an image-free variant of the same scene.
    const glb = writeGlb({
      meshes: [{ name: "crate", primitives: [{ ...box(1, 1, 1), material: 0 }] }, { name: "pole", primitives: [{ ...cylinder(0.1, 2, 6), material: 0 }] }],
      materials: [{ name: "steel", baseColor: [0.5, 0.5, 0.55, 1], unlit: true }],
      nodes: [{ name: "root", children: [1, 2] }, { mesh: 0, translation: [1, 0, 0] }, { mesh: 1 }],
      roots: [0],
    });
    const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, "");
    const names: string[] = [];
    gltf.scene.traverse((o) => {
      if ((o as { isMesh?: boolean }).isMesh) names.push(o.name);
    });
    expect(names).toHaveLength(2);
  });
});

describe("malformed input", () => {
  it.each([
    ["empty", new Uint8Array()],
    ["wrong magic", new TextEncoder().encode("not a glb file at all, really")],
    ["truncated", sampleGlb().subarray(0, 40)],
  ])("rejects %s", (_name, bytes) => {
    expect(() => parseGlb(bytes)).toThrow(GltfError);
  });

  it("rejects glTF 1.0 and broken references", () => {
    expect(() => parseGltfJson(JSON.stringify({ asset: { version: "1.0" } }))).toThrow(/2\.0/);
    expect(() => parseGltfJson(JSON.stringify({ asset: { version: "2.0" }, meshes: [{ primitives: [{ attributes: { POSITION: 3 } }] }] }))).toThrow(/POSITION/);
    expect(() => parseGltfJson("{oops")).toThrow(GltfError);
  });

  it("survives node cycles", () => {
    const doc = parseGltfJson(JSON.stringify({ asset: { version: "2.0" }, nodes: [{ children: [1] }, { children: [0] }], scenes: [{ nodes: [0] }] }));
    expect(gltfStats(doc).sceneTriangles).toBe(0);
  });

  it("flags required extensions the viewer cannot decode", () => {
    const doc = parseGltfJson(JSON.stringify({ asset: { version: "2.0" }, extensionsRequired: ["KHR_draco_mesh_compression", "KHR_materials_unlit"] }));
    expect(gltfStats(doc).unsupportedExtensions).toEqual(["KHR_draco_mesh_compression"]);
    const ktx = parseGltfJson(JSON.stringify({ asset: { version: "2.0" }, extensionsRequired: ["KHR_texture_basisu", "KHR_texture_transform"] }));
    expect(gltfStats(ktx).unsupportedExtensions).toEqual(["KHR_texture_basisu"]);
  });
});
