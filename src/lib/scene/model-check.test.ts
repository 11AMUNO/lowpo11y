import { describe, expect, it } from "vitest";
import { box } from "@/lib/formats/geometry";
import { writeGlb } from "@/lib/formats/glb-writer";
import { checkModelFile } from "./model-check";

const glb = () => writeGlb({ meshes: [{ primitives: [box(1, 1, 1)] }], nodes: [{ mesh: 0 }], roots: [0] });

describe("checkModelFile", () => {
  it("accepts a GLB and reports its stats", () => {
    const r = checkModelFile("crate.glb", glb());
    expect(r.ok && r.stats.sceneTriangles).toBe(12);
  });

  it("explains formats that need converting", () => {
    for (const name of ["prop.fbx", "prop.OBJ", "scene.blend"]) {
      const r = checkModelFile(name, new Uint8Array(4));
      expect(r.ok).toBe(false);
      expect(!r.ok && r.message).toMatch(/Convert it to GLB/);
    }
    expect(checkModelFile("notes.txt", new Uint8Array(4))).toEqual({ ok: false, message: "Only GLB or glTF models can be added." });
  });

  it("refuses broken files, compressed files and external references", () => {
    expect(checkModelFile("bad.glb", new TextEncoder().encode("garbage")).ok).toBe(false);
    const json = { asset: { version: "2.0" }, extensionsRequired: ["KHR_draco_mesh_compression"], extensionsUsed: ["KHR_draco_mesh_compression"] };
    const draco = checkModelFile("draco.gltf", new TextEncoder().encode(JSON.stringify(json)));
    expect(!draco.ok && draco.message).toMatch(/KHR_draco_mesh_compression/);
    const ext = checkModelFile("split.gltf", new TextEncoder().encode(JSON.stringify({ asset: { version: "2.0" }, buffers: [{ uri: "scene.bin", byteLength: 4 }] })));
    expect(!ext.ok && ext.message).toMatch(/one \.glb file/);
  });
});
