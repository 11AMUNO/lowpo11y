import { readFileSync } from "node:fs";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";

THREE.TextureLoader.prototype.load = function (url: string) {
  const t = new THREE.Texture();
  t.userData.sourceUrl = url;
  return t;
} as never;

async function main() {
  const file = process.argv[2]!;
  const buf = readFileSync(file);
  const group = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), "");
  let tris = 0;
  group.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(group);
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const g = m.geometry;
      tris += (g.index ? g.index.count : g.attributes.position!.count) / 3;
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      console.log("mesh", m.name, "verts", g.attributes.position!.count, "attrs", Object.keys(g.attributes).join(","), "groups", g.groups.length,
        "mats", mats.map((x) => `${x.type}:${(x as THREE.MeshPhongMaterial).map?.userData.sourceUrl ?? "-"}`).join(" "), "scale", m.scale.toArray().map((v) => v.toFixed(3)).join(","));
    }
  });
  console.log("tris", tris, "size", box.getSize(new THREE.Vector3()).toArray().map((v) => v.toFixed(3)).join(" x "), "children", group.children.length, "animations", group.animations.length);
}
main().catch((e) => { console.error("ERR", e); process.exit(1); });
