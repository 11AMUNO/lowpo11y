/**
 * Minimal, dependency-free glTF 2.0 binary (GLB) writer: meshes, materials,
 * embedded images, node hierarchies, and optionally skins and animations.
 * Used for generated demo props, server-side conversions and tests.
 * Spec: https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
 */

export interface PrimitiveInput {
  positions: Float32Array;
  normals?: Float32Array;
  uvs?: Float32Array;
  /** RGBA floats 0..1 per vertex. */
  colors?: Float32Array;
  indices?: Uint16Array | Uint32Array;
  material?: number;
  /** Skinning: 4 joint indices per vertex (into the skin's `joints`). */
  joints?: Uint16Array;
  /** Skinning: 4 weights per vertex, summing to 1. */
  weights?: Float32Array;
}

export interface MeshInput {
  name?: string;
  primitives: PrimitiveInput[];
}

export interface MaterialInput {
  name?: string;
  baseColor?: [number, number, number, number];
  /** Index into `images`. */
  texture?: number;
  metallic?: number;
  roughness?: number;
  doubleSided?: boolean;
  alphaMode?: "OPAQUE" | "MASK" | "BLEND";
  alphaCutoff?: number;
  /** KHR_materials_unlit. */
  unlit?: boolean;
  /** Nearest-neighbour sampling for pixel textures. */
  nearest?: boolean;
  emissive?: [number, number, number];
}

export interface ImageInput {
  name?: string;
  mimeType: "image/png" | "image/jpeg";
  data: Uint8Array;
}

export interface NodeInput {
  name?: string;
  mesh?: number;
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  children?: number[];
  extras?: Record<string, unknown>;
  /** Index into `skins` for a skinned mesh node. */
  skin?: number;
}

export interface SkinInput {
  name?: string;
  /** Node indices of the joints. */
  joints: number[];
  /** One column-major 4×4 matrix per joint. */
  inverseBindMatrices: Float32Array;
  skeleton?: number;
}

export interface AnimationChannelInput {
  node: number;
  path: "translation" | "rotation" | "scale";
  /** Keyframe times in seconds, ascending. */
  times: Float32Array;
  /** 3 values per key for translation/scale, 4 (x, y, z, w) for rotation. */
  values: Float32Array;
  interpolation?: "LINEAR" | "STEP";
}

export interface AnimationInput {
  name?: string;
  channels: AnimationChannelInput[];
}

export interface SceneInput {
  meshes: MeshInput[];
  materials?: MaterialInput[];
  images?: ImageInput[];
  nodes: NodeInput[];
  /** Indices of root nodes in the default scene. */
  roots: number[];
  generator?: string;
  copyright?: string;
  extras?: Record<string, unknown>;
  skins?: SkinInput[];
  animations?: AnimationInput[];
}

const ARRAY_BUFFER = 34962;
const ELEMENT_ARRAY_BUFFER = 34963;
const FLOAT = 5126;
const UNSIGNED_SHORT = 5123;
const UNSIGNED_INT = 5125;

function pad4(n: number) {
  return (n + 3) & ~3;
}

export function writeGlb(scene: SceneInput): Uint8Array {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const bufferViews: Record<string, unknown>[] = [];
  const accessors: Record<string, unknown>[] = [];

  const addView = (data: Uint8Array, target?: number) => {
    const offset = byteLength;
    chunks.push(data);
    const padded = pad4(data.byteLength);
    if (padded > data.byteLength) chunks.push(new Uint8Array(padded - data.byteLength));
    byteLength += padded;
    bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: data.byteLength, ...(target ? { target } : {}) });
    return bufferViews.length - 1;
  };
  const bytesOf = (a: ArrayBufferView) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

  const addFloatAccessor = (data: Float32Array, size: 1 | 2 | 3 | 4 | 16, withBounds = false, target: number | undefined = ARRAY_BUFFER) => {
    const view = addView(bytesOf(data), target);
    const count = data.length / size;
    const type = size === 1 ? "SCALAR" : size === 2 ? "VEC2" : size === 3 ? "VEC3" : size === 4 ? "VEC4" : "MAT4";
    const acc: Record<string, unknown> = { bufferView: view, componentType: FLOAT, count, type };
    if (withBounds) {
      const min = new Array<number>(size).fill(Infinity);
      const max = new Array<number>(size).fill(-Infinity);
      for (let i = 0; i < data.length; i += size)
        for (let c = 0; c < size; c++) {
          min[c] = Math.min(min[c]!, data[i + c]!);
          max[c] = Math.max(max[c]!, data[i + c]!);
        }
      acc.min = min;
      acc.max = max;
    }
    accessors.push(acc);
    return accessors.length - 1;
  };

  const meshes = scene.meshes.map((m) => ({
    ...(m.name ? { name: m.name } : {}),
    primitives: m.primitives.map((p) => {
      if (p.positions.length % 3 !== 0) throw new Error("positions length must be a multiple of 3");
      const attributes: Record<string, number> = { POSITION: addFloatAccessor(p.positions, 3, true) };
      if (p.normals) attributes.NORMAL = addFloatAccessor(p.normals, 3);
      if (p.uvs) attributes.TEXCOORD_0 = addFloatAccessor(p.uvs, 2);
      if (p.colors) attributes.COLOR_0 = addFloatAccessor(p.colors, 4);
      if (p.joints && p.weights) {
        const view = addView(bytesOf(p.joints), ARRAY_BUFFER);
        accessors.push({ bufferView: view, componentType: UNSIGNED_SHORT, count: p.joints.length / 4, type: "VEC4" });
        attributes.JOINTS_0 = accessors.length - 1;
        attributes.WEIGHTS_0 = addFloatAccessor(p.weights, 4);
      }
      const prim: Record<string, unknown> = { attributes, mode: 4 };
      if (p.indices) {
        const view = addView(bytesOf(p.indices), ELEMENT_ARRAY_BUFFER);
        accessors.push({ bufferView: view, componentType: p.indices instanceof Uint32Array ? UNSIGNED_INT : UNSIGNED_SHORT, count: p.indices.length, type: "SCALAR" });
        prim.indices = accessors.length - 1;
      }
      if (p.material !== undefined) prim.material = p.material;
      return prim;
    }),
  }));

  const images = (scene.images ?? []).map((img) => ({
    ...(img.name ? { name: img.name } : {}),
    mimeType: img.mimeType,
    bufferView: addView(img.data),
  }));

  const samplers = [
    { magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }, // linear
    { magFilter: 9728, minFilter: 9728, wrapS: 10497, wrapT: 10497 }, // nearest
  ];
  const textures: { source: number; sampler: number }[] = [];
  const extensionsUsed = new Set<string>();

  const materials = (scene.materials ?? []).map((m) => {
    const pbr: Record<string, unknown> = {
      baseColorFactor: m.baseColor ?? [1, 1, 1, 1],
      metallicFactor: m.metallic ?? 0,
      roughnessFactor: m.roughness ?? 1,
    };
    if (m.texture !== undefined) {
      textures.push({ source: m.texture, sampler: m.nearest ? 1 : 0 });
      pbr.baseColorTexture = { index: textures.length - 1 };
    }
    const mat: Record<string, unknown> = { pbrMetallicRoughness: pbr };
    if (m.name) mat.name = m.name;
    if (m.doubleSided) mat.doubleSided = true;
    if (m.alphaMode && m.alphaMode !== "OPAQUE") mat.alphaMode = m.alphaMode;
    if (m.alphaMode === "MASK") mat.alphaCutoff = m.alphaCutoff ?? 0.5;
    if (m.emissive) mat.emissiveFactor = m.emissive;
    if (m.unlit) {
      mat.extensions = { KHR_materials_unlit: {} };
      extensionsUsed.add("KHR_materials_unlit");
    }
    return mat;
  });

  const json: Record<string, unknown> = {
    asset: { version: "2.0", generator: scene.generator ?? "LOWPO11Y glb-writer", ...(scene.copyright ? { copyright: scene.copyright } : {}) },
    scene: 0,
    scenes: [{ nodes: scene.roots, ...(scene.extras ? { extras: scene.extras } : {}) }],
    nodes: scene.nodes.map((n) => {
      const out: Record<string, unknown> = {};
      if (n.name) out.name = n.name;
      if (n.mesh !== undefined) out.mesh = n.mesh;
      if (n.translation) out.translation = n.translation;
      if (n.rotation) out.rotation = n.rotation;
      if (n.scale) out.scale = n.scale;
      if (n.children?.length) out.children = n.children;
      if (n.extras) out.extras = n.extras;
      if (n.skin !== undefined) out.skin = n.skin;
      return out;
    }),
    meshes,
    accessors,
    bufferViews,
    buffers: [{ byteLength }],
  };
  if (scene.skins?.length)
    json.skins = scene.skins.map((sk) => ({
      ...(sk.name ? { name: sk.name } : {}),
      joints: sk.joints,
      inverseBindMatrices: addFloatAccessor(sk.inverseBindMatrices, 16, false, undefined),
      ...(sk.skeleton !== undefined ? { skeleton: sk.skeleton } : {}),
    }));
  if (scene.animations?.length)
    json.animations = scene.animations.map((a) => {
      const animSamplers: Record<string, unknown>[] = [];
      const channels = a.channels.map((c) => {
        // animation inputs must carry min/max
        animSamplers.push({ input: addFloatAccessor(c.times, 1, true, undefined), output: addFloatAccessor(c.values, c.path === "rotation" ? 4 : 3, false, undefined), interpolation: c.interpolation ?? "LINEAR" });
        return { sampler: animSamplers.length - 1, target: { node: c.node, path: c.path } };
      });
      return { ...(a.name ? { name: a.name } : {}), samplers: animSamplers, channels };
    });
  // skins and animations appended data after the literal above was built
  json.buffers = [{ byteLength }];
  if (materials.length) json.materials = materials;
  if (images.length) {
    json.images = images;
    json.textures = textures;
    json.samplers = samplers;
  }
  if (extensionsUsed.size) json.extensionsUsed = [...extensionsUsed];

  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLen = pad4(jsonBytes.byteLength);
  const binLen = pad4(byteLength);
  const total = 12 + 8 + jsonLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // "glTF"
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLen, true);
  dv.setUint32(16, 0x4e4f534a, true); // "JSON"
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.byteLength, 20 + jsonLen); // pad JSON with spaces
  const binStart = 20 + jsonLen;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // "BIN\0"
  let off = binStart + 8;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out;
}
