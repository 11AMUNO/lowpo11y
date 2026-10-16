/**
 * Extracts world-space triangle meshes from a GLB for software rendering
 * (thumbnails) and analysis. Supports float/normalised accessors, indexed and
 * non-indexed triangles, interleaved buffer views and node hierarchies.
 * Compressed meshes (Draco/meshopt) are reported as unsupported.
 */
import type { GltfDocument, GltfJson } from "./gltf";

export interface ExtractedMesh {
  name?: string;
  /** World-space positions, xyz. */
  positions: Float32Array;
  uvs: Float32Array | null;
  colors: Float32Array | null;
  indices: Uint32Array;
  baseColor: [number, number, number, number];
  /** Index into json.images of the base colour texture, if any. */
  imageIndex: number | null;
  nearest: boolean;
  alphaMode: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff: number;
  doubleSided: boolean;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };

export class UnsupportedGltfError extends Error {}

/** Reads any accessor into a Float32Array (normalised integers mapped to 0..1 / -1..1). */
export function readAccessor(json: GltfJson, bin: Uint8Array, index: number): { data: Float32Array; size: number } {
  const acc = json.accessors?.[index];
  if (!acc) throw new UnsupportedGltfError(`Missing accessor ${index}`);
  const size = COMPONENTS[acc.type];
  const bytes = BYTES[acc.componentType];
  if (!size || !bytes) throw new UnsupportedGltfError(`Unsupported accessor ${index}`);
  const out = new Float32Array(acc.count * size);
  if (acc.bufferView === undefined) return { data: out, size }; // all zeros per spec (sparse not handled)
  if (acc.sparse) throw new UnsupportedGltfError("Sparse accessors are not supported for previews.");
  const view = json.bufferViews[acc.bufferView];
  if ((view.buffer ?? 0) !== 0) throw new UnsupportedGltfError("External buffers are not supported for previews.");
  const stride = view.byteStride ?? size * bytes;
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  if (base + stride * Math.max(0, acc.count - 1) + size * bytes > bin.byteLength) throw new UnsupportedGltfError("Accessor reads past the binary chunk.");
  const dv = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const norm = !!acc.normalized;
  for (let i = 0; i < acc.count; i++) {
    const o = base + i * stride;
    for (let c = 0; c < size; c++) {
      const p = o + c * bytes;
      let v: number;
      switch (acc.componentType) {
        case 5126: v = dv.getFloat32(p, true); break;
        case 5125: v = dv.getUint32(p, true); break;
        case 5123: v = dv.getUint16(p, true); if (norm) v /= 65535; break;
        case 5122: v = dv.getInt16(p, true); if (norm) v = Math.max(v / 32767, -1); break;
        case 5121: v = dv.getUint8(p); if (norm) v /= 255; break;
        default: v = dv.getInt8(p); if (norm) v = Math.max(v / 127, -1);
      }
      out[i * size + c] = v;
    }
  }
  return { data: out, size };
}

type Mat4 = Float64Array;

function compose(n: GltfJson): Mat4 {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return Float64Array.from(n.matrix as number[]);
  const [tx, ty, tz] = (n.translation as number[]) ?? [0, 0, 0];
  const [qx, qy, qz, qw] = (n.rotation as number[]) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (n.scale as number[]) ?? [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return Float64Array.from([
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ]);
}

function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

const IDENTITY = Float64Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

export function extractMeshes(doc: GltfDocument, maxTriangles = 2_000_000): ExtractedMesh[] {
  const { json, bin } = doc;
  if (!bin) throw new UnsupportedGltfError("Previews need a .glb with embedded geometry.");
  const required: string[] = json.extensionsRequired ?? [];
  const compressed = required.filter((e) => e === "KHR_draco_mesh_compression" || e === "EXT_meshopt_compression");
  if (compressed.length) throw new UnsupportedGltfError(`Compressed meshes (${compressed.join(", ")}) are not supported for previews.`);

  const out: ExtractedMesh[] = [];
  let total = 0;
  const nodes: GltfJson[] = json.nodes ?? [];
  const childSet = new Set(nodes.flatMap((n) => n.children ?? []));
  const roots: number[] = json.scenes?.[json.scene ?? 0]?.nodes ?? nodes.map((_, i) => i).filter((i) => !childSet.has(i));
  const seen = new Set<number>();

  const visit = (index: number, parent: Mat4, depth: number) => {
    if (depth > 128 || seen.has(index)) return;
    seen.add(index);
    const node = nodes[index];
    if (!node) return;
    const world = mul(parent, compose(node));
    if (node.mesh !== undefined) {
      for (const prim of json.meshes?.[node.mesh]?.primitives ?? []) {
        if ((prim.mode ?? 4) !== 4) continue; // only triangle lists
        const pos = readAccessor(json, bin, prim.attributes.POSITION);
        const count = pos.data.length / 3;
        const positions = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const x = pos.data[i * 3]!, y = pos.data[i * 3 + 1]!, z = pos.data[i * 3 + 2]!;
          positions[i * 3] = world[0]! * x + world[4]! * y + world[8]! * z + world[12]!;
          positions[i * 3 + 1] = world[1]! * x + world[5]! * y + world[9]! * z + world[13]!;
          positions[i * 3 + 2] = world[2]! * x + world[6]! * y + world[10]! * z + world[14]!;
        }
        const indices =
          prim.indices !== undefined
            ? Uint32Array.from(readAccessor(json, bin, prim.indices).data)
            : Uint32Array.from({ length: count }, (_, i) => i);
        total += indices.length / 3;
        if (total > maxTriangles) throw new UnsupportedGltfError(`More than ${maxTriangles.toLocaleString("en-GB")} triangles; too large to preview.`);
        const mat = prim.material !== undefined ? json.materials?.[prim.material] : undefined;
        const pbr = mat?.pbrMetallicRoughness ?? {};
        const texIndex = pbr.baseColorTexture?.index;
        const tex = texIndex !== undefined ? json.textures?.[texIndex] : undefined;
        const sampler = tex?.sampler !== undefined ? json.samplers?.[tex.sampler] : undefined;
        const uvSet = pbr.baseColorTexture?.texCoord ?? 0;
        out.push({
          name: node.name,
          positions,
          uvs: prim.attributes[`TEXCOORD_${uvSet}`] !== undefined ? readAccessor(json, bin, prim.attributes[`TEXCOORD_${uvSet}`]).data : null,
          colors: prim.attributes.COLOR_0 !== undefined ? expandColors(readAccessor(json, bin, prim.attributes.COLOR_0)) : null,
          indices,
          baseColor: (pbr.baseColorFactor as [number, number, number, number]) ?? [1, 1, 1, 1],
          imageIndex: tex?.source ?? null,
          nearest: sampler?.magFilter === 9728,
          alphaMode: mat?.alphaMode ?? "OPAQUE",
          alphaCutoff: mat?.alphaCutoff ?? 0.5,
          doubleSided: !!mat?.doubleSided,
        });
      }
    }
    for (const c of node.children ?? []) visit(c, world, depth + 1);
  };
  for (const r of roots) visit(r, IDENTITY, 0);
  return out;
}

function expandColors(a: { data: Float32Array; size: number }): Float32Array {
  if (a.size === 4) return a.data;
  const n = a.data.length / 3;
  const out = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    out[i * 4] = a.data[i * 3]!;
    out[i * 4 + 1] = a.data[i * 3 + 1]!;
    out[i * 4 + 2] = a.data[i * 3 + 2]!;
    out[i * 4 + 3] = 1;
  }
  return out;
}

/** Raw bytes of an embedded image (bufferView or data URI). */
export function imageBytes(doc: GltfDocument, imageIndex: number): Uint8Array | null {
  const img = doc.json.images?.[imageIndex];
  if (!img) return null;
  if (img.bufferView !== undefined && doc.bin) {
    const v = doc.json.bufferViews[img.bufferView];
    return doc.bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
  }
  if (typeof img.uri === "string" && img.uri.startsWith("data:")) {
    try {
      return Uint8Array.from(atob(img.uri.slice(img.uri.indexOf(",") + 1)), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }
  return null;
}
