/**
 * A small skinned, animated demo model (CC0) for the model inspector and its
 * tests: a textured square column with two bones and two clips.
 */
import { writeGlb } from "@/lib/formats/glb-writer";

const SEGMENTS = 8;
const HEIGHT = 2;
const HALF = 0.1;

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const quat = (axis: "y" | "z", deg: number): number[] => {
  const h = (deg * Math.PI) / 360;
  return axis === "y" ? [0, Math.sin(h), 0, Math.cos(h)] : [0, 0, Math.sin(h), Math.cos(h)];
};

/** Column 0.2 × 2 × 0.2 m: bone "Lower" at the base, "Upper" at 1 m; clips "Bend" (2 s) and "Twist" (1.5 s). */
export function buildRiggedPole(texture?: Uint8Array): Uint8Array {
  const pos: number[] = [],
    nor: number[] = [],
    uv: number[] = [],
    joints: number[] = [],
    weights: number[] = [],
    idx: number[] = [];
  const vert = (x: number, y: number, z: number, n: [number, number, number], u: number, v: number) => {
    pos.push(x, y, z);
    nor.push(...n);
    uv.push(u, v);
    const w1 = smoothstep(0.8, 1.2, y);
    joints.push(0, 1, 0, 0);
    weights.push(1 - w1, w1, 0, 0);
    return pos.length / 3 - 1;
  };
  // four sides, each a strip of SEGMENTS quads
  const sides: { n: [number, number, number]; a: [number, number]; b: [number, number] }[] = [
    { n: [0, 0, 1], a: [-HALF, HALF], b: [HALF, HALF] },
    { n: [1, 0, 0], a: [HALF, HALF], b: [HALF, -HALF] },
    { n: [0, 0, -1], a: [HALF, -HALF], b: [-HALF, -HALF] },
    { n: [-1, 0, 0], a: [-HALF, -HALF], b: [-HALF, HALF] },
  ];
  sides.forEach((side, si) => {
    const base = pos.length / 3;
    for (let k = 0; k <= SEGMENTS; k++) {
      const y = (k / SEGMENTS) * HEIGHT;
      vert(side.a[0], y, side.a[1], side.n, si / 4, 1 - k / SEGMENTS);
      vert(side.b[0], y, side.b[1], side.n, (si + 1) / 4, 1 - k / SEGMENTS);
    }
    for (let k = 0; k < SEGMENTS; k++) {
      const i = base + k * 2;
      idx.push(i, i + 1, i + 3, i, i + 3, i + 2);
    }
  });
  for (const [y, n] of [
    [HEIGHT, 1],
    [0, -1],
  ] as const) {
    const c = [vert(-HALF, y, HALF, [0, n, 0], 0, 0), vert(HALF, y, HALF, [0, n, 0], 1, 0), vert(HALF, y, -HALF, [0, n, 0], 1, 1), vert(-HALF, y, -HALF, [0, n, 0], 0, 1)];
    idx.push(...(n > 0 ? [c[0]!, c[1]!, c[2]!, c[0]!, c[2]!, c[3]!] : [c[0]!, c[2]!, c[1]!, c[0]!, c[3]!, c[2]!]));
  }

  return writeGlb({
    generator: "LOWPO11Y demo props",
    copyright: "LOWPO11Y demo content, CC0 1.0",
    images: texture ? [{ name: "demo-uv-checker.png", mimeType: "image/png", data: texture }] : [],
    materials: [texture ? { name: "uv checker", texture: 0, nearest: true } : { name: "grey", baseColor: [0.6, 0.6, 0.6, 1] }],
    meshes: [
      {
        name: "pole",
        primitives: [
          {
            positions: new Float32Array(pos),
            normals: new Float32Array(nor),
            uvs: new Float32Array(uv),
            joints: new Uint16Array(joints),
            weights: new Float32Array(weights),
            indices: new Uint16Array(idx),
            material: 0,
          },
        ],
      },
    ],
    nodes: [
      { name: "Armature", children: [1] },
      { name: "Lower", translation: [0, 0, 0], children: [2] },
      { name: "Upper", translation: [0, 1, 0] },
      { name: "Pole", mesh: 0, skin: 0 },
    ],
    roots: [0, 3],
    skins: [
      {
        name: "Armature",
        joints: [1, 2],
        skeleton: 1,
        // column-major inverse bind matrices: identity, and a 1 m drop for the upper bone
        inverseBindMatrices: new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -1, 0, 1]),
      },
    ],
    animations: [
      { name: "Bend", channels: [{ node: 2, path: "rotation", times: new Float32Array([0, 1, 2]), values: new Float32Array([...quat("z", 0), ...quat("z", 60), ...quat("z", 0)]) }] },
      { name: "Twist", channels: [{ node: 1, path: "rotation", times: new Float32Array([0, 0.75, 1.5]), values: new Float32Array([...quat("y", 0), ...quat("y", 90), ...quat("y", 0)]) }] },
    ],
  });
}
