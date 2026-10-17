import { describe, expect, it } from "vitest";
import { AnimationMixer, Vector3, type SkinnedMesh } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { gltfStats, parseGlb } from "@/lib/formats/gltf";
import { buildRiggedPole } from "./rigged";

describe("rigged demo pole", () => {
  const glb = buildRiggedPole();

  it("is a valid skinned, animated glTF", () => {
    const stats = gltfStats(parseGlb(glb));
    expect(stats.skins).toBe(1);
    expect(stats.animations).toEqual([
      { name: "Bend", channels: 1, durationSeconds: 2 },
      { name: "Twist", channels: 1, durationSeconds: 1.5 },
    ]);
    expect(stats.sceneTriangles).toBe(68);
    expect(stats.drawCalls).toBe(1);
    expect(stats.bounds?.size.map((v) => Math.round(v * 100) / 100)).toEqual([0.2, 2, 0.2]);
  });

  it("loads in three.js and the Bend clip really bends the top", async () => {
    const gltf = await new GLTFLoader().parseAsync(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, "");
    let mesh: SkinnedMesh | null = null;
    gltf.scene.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) mesh = o as SkinnedMesh;
    });
    expect(mesh).not.toBeNull();
    const m = mesh! as SkinnedMesh;
    expect(m.skeleton.bones.map((b) => b.name)).toEqual(["Lower", "Upper"]);
    expect(gltf.animations.map((a) => a.name)).toEqual(["Bend", "Twist"]);

    // a vertex at the top of the column (y = 2)
    const pos = m.geometry.attributes.position!;
    let top = 0;
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > pos.getY(top)) top = i;
    const at = () => {
      gltf.scene.updateMatrixWorld(true);
      m.skeleton.update();
      return m.applyBoneTransform(top, new Vector3().fromBufferAttribute(pos, top));
    };
    const rest = at();
    expect(rest.y).toBeCloseTo(2, 3);
    const mixer = new AnimationMixer(gltf.scene);
    mixer.clipAction(gltf.animations[0]!).play();
    mixer.setTime(1); // peak of the bend: 60° about Z at the upper bone (y = 1)
    const bent = at();
    expect(bent.y).toBeLessThan(1.7);
    expect(Math.abs(bent.x - rest.x)).toBeGreaterThan(0.7);
  });
});
