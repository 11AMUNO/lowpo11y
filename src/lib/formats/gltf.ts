/**
 * glTF 2.0 reader for validation and statistics. Counts come from accessor
 * metadata, so no geometry decoding is needed; embedded image sizes are read
 * from their headers. Malformed input throws GltfError, never crashes.
 */
import { imageSize } from "./image-size";

export class GltfError extends Error {}

/* eslint-disable @typescript-eslint/no-explicit-any */
export type GltfJson = Record<string, any>;

export interface GltfDocument {
  json: GltfJson;
  bin: Uint8Array | null;
}

const MAX_JSON_BYTES = 64 * 1024 * 1024;

export function parseGlb(b: Uint8Array): GltfDocument {
  if (b.byteLength < 20) throw new GltfError("File is too small to be a GLB.");
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== 0x46546c67) throw new GltfError("Not a GLB file (missing glTF header).");
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new GltfError(`Unsupported GLB version ${version}; only glTF 2.0 is supported.`);
  const length = dv.getUint32(8, true);
  if (length > b.byteLength) throw new GltfError("GLB header length is larger than the file (truncated?).");
  let offset = 12;
  let json: GltfJson | null = null;
  let bin: Uint8Array | null = null;
  while (offset + 8 <= length) {
    const chunkLength = dv.getUint32(offset, true);
    const chunkType = dv.getUint32(offset + 4, true);
    const start = offset + 8;
    if (start + chunkLength > length) throw new GltfError("GLB chunk runs past the end of the file.");
    if (chunkType === 0x4e4f534a) {
      if (chunkLength > MAX_JSON_BYTES) throw new GltfError("GLB JSON chunk is unreasonably large.");
      try {
        json = JSON.parse(new TextDecoder().decode(b.subarray(start, start + chunkLength))) as GltfJson;
      } catch {
        throw new GltfError("GLB JSON chunk is not valid JSON.");
      }
    } else if (chunkType === 0x004e4942 && !bin) {
      bin = b.subarray(start, start + chunkLength);
    }
    offset = start + chunkLength;
  }
  if (!json) throw new GltfError("GLB has no JSON chunk.");
  validate(json, bin);
  return { json, bin };
}

export function parseGltfJson(text: string): GltfDocument {
  let json: GltfJson;
  try {
    json = JSON.parse(text) as GltfJson;
  } catch {
    throw new GltfError("glTF file is not valid JSON.");
  }
  validate(json, null);
  return { json, bin: null };
}

const COMPONENT_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const TYPE_SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };

function arr(v: unknown): any[] {
  return Array.isArray(v) ? v : [];
}

function validate(json: GltfJson, bin: Uint8Array | null) {
  if (!json || typeof json !== "object") throw new GltfError("glTF root must be an object.");
  const version = json.asset?.version;
  if (typeof version !== "string" || !version.startsWith("2.")) throw new GltfError("Only glTF 2.0 assets are supported.");
  const accessors = arr(json.accessors);
  const views = arr(json.bufferViews);
  const buffers = arr(json.buffers);
  views.forEach((v, i) => {
    if (typeof v?.buffer !== "number" || !buffers[v.buffer]) throw new GltfError(`bufferView ${i} references a missing buffer.`);
    const end = (v.byteOffset ?? 0) + (v.byteLength ?? 0);
    if (v.buffer === 0 && bin && buffers[0]?.uri === undefined && end > bin.byteLength) {
      throw new GltfError(`bufferView ${i} reads past the end of the binary chunk.`);
    }
  });
  accessors.forEach((a, i) => {
    if (!COMPONENT_SIZE[a?.componentType] || !TYPE_SIZE[a?.type]) throw new GltfError(`accessor ${i} has an invalid type.`);
    if (!Number.isInteger(a.count) || a.count < 0) throw new GltfError(`accessor ${i} has an invalid count.`);
    if (a.bufferView !== undefined && !views[a.bufferView]) throw new GltfError(`accessor ${i} references a missing bufferView.`);
  });
  arr(json.meshes).forEach((m, mi) =>
    arr(m?.primitives).forEach((p, pi) => {
      const pos = p?.attributes?.POSITION;
      if (pos === undefined || !accessors[pos]) throw new GltfError(`mesh ${mi} primitive ${pi} has no POSITION accessor.`);
      if (p.indices !== undefined && !accessors[p.indices]) throw new GltfError(`mesh ${mi} primitive ${pi} references a missing index accessor.`);
    }),
  );
  arr(json.nodes).forEach((n, i) => {
    if (n?.mesh !== undefined && !arr(json.meshes)[n.mesh]) throw new GltfError(`node ${i} references a missing mesh.`);
    for (const c of arr(n?.children)) if (!arr(json.nodes)[c]) throw new GltfError(`node ${i} has a missing child.`);
  });
}

/* ------------------------------------------------------------- statistics */

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r]! += a[k * 4 + r]! * b[c * 4 + k]!;
  return o;
}

function nodeMatrix(n: GltfJson): Mat4 {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix as number[];
  const [tx, ty, tz] = (n.translation as number[]) ?? [0, 0, 0];
  const [qx, qy, qz, qw] = (n.rotation as number[]) ?? [0, 0, 0, 1];
  const [sx, sy, sz] = (n.scale as number[]) ?? [1, 1, 1];
  const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
    2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
    2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
    tx, ty, tz, 1,
  ];
}

function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number] {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}

export interface GltfImageInfo {
  index: number;
  name?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  bytes?: number;
  external: boolean;
}

export interface GltfStats {
  generator?: string;
  copyright?: string;
  meshes: number;
  primitives: number;
  nodes: number;
  materials: number;
  textures: number;
  images: GltfImageInfo[];
  animations: { name?: string; channels: number; durationSeconds?: number }[];
  skins: number;
  morphTargets: number;
  /** Triangles drawn by the default scene, counting every mesh instance. */
  sceneTriangles: number;
  /** Triangles in the unique mesh geometry, each mesh counted once. */
  uniqueTriangles: number;
  sceneVertices: number;
  uniqueVertices: number;
  /** One per primitive instance in the scene. Approximate: renderers may batch or split. */
  drawCalls: number;
  uvChannels: number;
  hasNormals: boolean;
  hasVertexColors: boolean;
  bounds: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number] } | null;
  extensionsUsed: string[];
  extensionsRequired: string[];
  /** Required extensions the site's viewers cannot decode. */
  unsupportedExtensions: string[];
}

/** Extensions three.js loads out of the box in our viewers (no external decoders). */
export const SUPPORTED_EXTENSIONS = new Set([
  "KHR_materials_unlit",
  "KHR_texture_transform",
  "KHR_mesh_quantization",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_volume",
  "KHR_materials_clearcoat",
  "KHR_materials_sheen",
  "KHR_lights_punctual",
  "KHR_texture_basisu",
  "EXT_texture_webp",
]);

function primitiveTriangles(prim: GltfJson, accessors: GltfJson[]): number {
  const mode = prim.mode ?? 4;
  const count = prim.indices !== undefined ? accessors[prim.indices]?.count ?? 0 : accessors[prim.attributes.POSITION]?.count ?? 0;
  if (mode === 4) return Math.floor(count / 3);
  if (mode === 5 || mode === 6) return Math.max(0, count - 2);
  return 0; // points and lines
}

export function gltfStats(doc: GltfDocument): GltfStats {
  const { json, bin } = doc;
  const accessors = arr(json.accessors);
  const meshes = arr(json.meshes);
  const nodes = arr(json.nodes);

  const meshTris = meshes.map((m) => arr(m.primitives).reduce((s, p) => s + primitiveTriangles(p, accessors), 0));
  const meshVerts = meshes.map((m) => arr(m.primitives).reduce((s, p) => s + (accessors[p.attributes.POSITION]?.count ?? 0), 0));

  let uvChannels = 0;
  let hasNormals = false;
  let hasVertexColors = false;
  let morphTargets = 0;
  for (const m of meshes)
    for (const p of arr(m.primitives)) {
      for (const key of Object.keys(p.attributes ?? {})) {
        const uv = /^TEXCOORD_(\d+)$/.exec(key);
        if (uv) uvChannels = Math.max(uvChannels, Number(uv[1]) + 1);
        if (key === "NORMAL") hasNormals = true;
        if (key.startsWith("COLOR_")) hasVertexColors = true;
      }
      morphTargets = Math.max(morphTargets, arr(p.targets).length);
    }

  // Walk the default scene to count instances and accumulate world-space bounds.
  const sceneIndex = json.scene ?? 0;
  const childSet = new Set(nodes.flatMap((n) => arr(n.children)));
  const roots: number[] = arr(json.scenes)[sceneIndex]?.nodes ?? nodes.map((_, i) => i).filter((i) => !childSet.has(i));
  let sceneTriangles = 0;
  let sceneVertices = 0;
  let drawCalls = 0;
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  const visited = new Set<number>();
  const walk = (index: number, parent: Mat4, depth: number) => {
    if (depth > 128 || visited.has(index)) return; // guard against cycles
    visited.add(index);
    const node = nodes[index];
    if (!node) return;
    const world = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined) {
      sceneTriangles += meshTris[node.mesh] ?? 0;
      sceneVertices += meshVerts[node.mesh] ?? 0;
      for (const p of arr(meshes[node.mesh]?.primitives)) {
        drawCalls++;
        const acc = accessors[p.attributes.POSITION];
        if (Array.isArray(acc?.min) && Array.isArray(acc?.max)) {
          const [a0, a1, a2] = acc.min as number[];
          const [b0, b1, b2] = acc.max as number[];
          for (const corner of [
            [a0, a1, a2], [b0, a1, a2], [a0, b1, a2], [a0, a1, b2], [b0, b1, a2], [b0, a1, b2], [a0, b1, b2], [b0, b1, b2],
          ] as [number, number, number][]) {
            const w = transformPoint(world, corner);
            for (let k = 0; k < 3; k++) {
              min[k] = Math.min(min[k]!, w[k]!);
              max[k] = Math.max(max[k]!, w[k]!);
            }
          }
        }
      }
    }
    for (const c of arr(node.children)) walk(c, world, depth + 1);
  };
  for (const r of roots) walk(r, IDENTITY, 0);

  const views = arr(json.bufferViews);
  const images: GltfImageInfo[] = arr(json.images).map((img, index) => {
    const info: GltfImageInfo = { index, name: img.name, mimeType: img.mimeType, external: false };
    let bytes: Uint8Array | null = null;
    if (img.bufferView !== undefined && bin) {
      const v = views[img.bufferView];
      if (v) bytes = bin.subarray(v.byteOffset ?? 0, (v.byteOffset ?? 0) + v.byteLength);
    } else if (typeof img.uri === "string" && img.uri.startsWith("data:")) {
      const comma = img.uri.indexOf(",");
      try {
        bytes = Uint8Array.from(atob(img.uri.slice(comma + 1)), (c) => c.charCodeAt(0));
      } catch {
        bytes = null;
      }
    } else if (typeof img.uri === "string") {
      info.external = true;
    }
    if (bytes) {
      info.bytes = bytes.byteLength;
      const size = imageSize(bytes);
      if (size) {
        info.width = size.width;
        info.height = size.height;
      }
    }
    return info;
  });

  const animations = arr(json.animations).map((a) => {
    let duration: number | undefined;
    for (const s of arr(a.samplers)) {
      const input = accessors[s.input];
      if (Array.isArray(input?.max)) duration = Math.max(duration ?? 0, input.max[0] as number);
    }
    return { name: a.name, channels: arr(a.channels).length, durationSeconds: duration };
  });

  const extensionsUsed = arr(json.extensionsUsed).map(String);
  const extensionsRequired = arr(json.extensionsRequired).map(String);
  const finite = min.every(Number.isFinite) && max.every(Number.isFinite);

  return {
    generator: json.asset?.generator,
    copyright: json.asset?.copyright,
    meshes: meshes.length,
    primitives: meshes.reduce((s, m) => s + arr(m.primitives).length, 0),
    nodes: nodes.length,
    materials: arr(json.materials).length,
    textures: arr(json.textures).length,
    images,
    animations,
    skins: arr(json.skins).length,
    morphTargets,
    sceneTriangles,
    uniqueTriangles: meshTris.reduce((a, b) => a + b, 0),
    sceneVertices,
    uniqueVertices: meshVerts.reduce((a, b) => a + b, 0),
    drawCalls,
    uvChannels,
    hasNormals,
    hasVertexColors,
    bounds: finite ? { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] } : null,
    extensionsUsed,
    extensionsRequired,
    unsupportedExtensions: extensionsRequired.filter((e) => !SUPPORTED_EXTENSIONS.has(e)),
  };
}
