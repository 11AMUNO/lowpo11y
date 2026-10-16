/**
 * FBX → GLB conversion for owner uploads (server-side, Node). Uses three.js's
 * FBXLoader to parse, then writes a clean glTF 2.0 binary with our writer.
 * World transforms are baked into geometry; textures referenced by the FBX
 * are resolved from the files uploaded alongside it and embedded unchanged.
 * Rigs and animations are not converted: the original FBX stays downloadable.
 */
import sharp from "sharp";
import * as THREE from "three";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { writeGlb, type ImageInput, type MaterialInput, type MeshInput, type NodeInput } from "@/lib/formats/glb-writer";
import { detectFormat } from "@/lib/validation/file-types";

export interface FbxConversion {
  glb: Uint8Array;
  warnings: string[];
  meshes: number;
  triangles: number;
  /** Texture references found in the FBX, and whether each was resolved. */
  textures: { ref: string; found: boolean }[];
}

export type TextureResolver = (ref: string) => Uint8Array | null | Promise<Uint8Array | null>;

/** Basename of a texture reference, whatever path style the exporter used. */
export function textureBasename(ref: string): string {
  return decodeURIComponent(ref).split(/[\\/]/).pop()!.toLowerCase();
}

function parseFbx(bytes: Uint8Array): THREE.Group {
  const original = THREE.TextureLoader.prototype.load;
  // FBXLoader asks a TextureLoader (which needs a DOM) for each texture. Record the reference instead.
  THREE.TextureLoader.prototype.load = function (url: string) {
    const t = new THREE.Texture();
    t.userData.sourceRef = url;
    return t;
  } as typeof original;
  try {
    const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new FBXLoader().parse(ab, "");
  } catch (e) {
    throw new Error(`The FBX file could not be read: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    THREE.TextureLoader.prototype.load = original;
  }
}

async function toEmbeddable(bytes: Uint8Array): Promise<{ data: Uint8Array; mimeType: "image/png" | "image/jpeg" } | null> {
  const fmt = detectFormat(bytes, "texture");
  if (fmt?.format === "png") return { data: bytes, mimeType: "image/png" };
  if (fmt?.format === "jpg") return { data: bytes, mimeType: "image/jpeg" };
  try {
    return { data: new Uint8Array(await sharp(bytes).png().toBuffer()), mimeType: "image/png" }; // TGA/BMP/TIFF etc.
  } catch {
    return null;
  }
}

export async function convertFbxToGlb(fbx: Uint8Array, resolveTexture: TextureResolver): Promise<FbxConversion> {
  const group = parseFbx(fbx);
  group.updateMatrixWorld(true);
  const warnings: string[] = [];

  const meshes: MeshInput[] = [];
  const nodes: NodeInput[] = [{ name: "root", children: [] }];
  const materials: MaterialInput[] = [];
  const materialIndex = new Map<string, number>();
  const images: ImageInput[] = [];
  const imageIndex = new Map<string, number | null>();
  const textures: { ref: string; found: boolean }[] = [];
  let triangles = 0;
  let skinned = false;

  const imageFor = async (ref: string): Promise<number | null> => {
    const key = textureBasename(ref);
    if (imageIndex.has(key)) return imageIndex.get(key)!;
    const bytes = await resolveTexture(ref);
    const embeddable = bytes ? await toEmbeddable(bytes) : null;
    textures.push({ ref, found: !!embeddable });
    if (!embeddable) {
      warnings.push(`Texture "${key}" referenced by the FBX was not found among the uploaded files.`);
      imageIndex.set(key, null);
      return null;
    }
    images.push({ name: key, ...embeddable });
    imageIndex.set(key, images.length - 1);
    return images.length - 1;
  };

  const materialFor = async (m: THREE.Material): Promise<number> => {
    if (materialIndex.has(m.uuid)) return materialIndex.get(m.uuid)!;
    const mm = m as THREE.MeshPhongMaterial;
    const ref = mm.map?.userData?.sourceRef as string | undefined;
    const tex = ref ? await imageFor(ref) : null;
    const opacity = mm.opacity ?? 1;
    const input: MaterialInput = {
      name: m.name || undefined,
      // With a texture linked, Blender's FBX export still writes its default 0.8 diffuse colour.
      // Blender's own glTF exporter uses white in that case, so do the same.
      baseColor: tex !== null ? [1, 1, 1, opacity] : [mm.color?.r ?? 1, mm.color?.g ?? 1, mm.color?.b ?? 1, opacity],
      texture: tex ?? undefined,
      roughness: 1,
      metallic: 0,
      doubleSided: m.side === THREE.DoubleSide,
      alphaMode: m.alphaTest > 0 ? "MASK" : m.transparent && opacity < 1 ? "BLEND" : "OPAQUE",
      alphaCutoff: m.alphaTest > 0 ? m.alphaTest : undefined,
    };
    materials.push(input);
    materialIndex.set(m.uuid, materials.length - 1);
    return materials.length - 1;
  };

  const meshObjects: THREE.Mesh[] = [];
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) meshObjects.push(o as THREE.Mesh);
  });

  for (const mesh of meshObjects) {
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) skinned = true;
    const g = mesh.geometry as THREE.BufferGeometry;
    const pos = g.getAttribute("position");
    if (!pos) continue;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const v = new THREE.Vector3();
    const positions = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      positions.set([v.x, v.y, v.z], i * 3);
    }
    const nAttr = g.getAttribute("normal");
    let normals: Float32Array | undefined;
    if (nAttr) {
      normals = new Float32Array(nAttr.count * 3);
      for (let i = 0; i < nAttr.count; i++) {
        v.fromBufferAttribute(nAttr, i).applyMatrix3(normalMatrix).normalize();
        normals.set([v.x, v.y, v.z], i * 3);
      }
    }
    const uvAttr = g.getAttribute("uv");
    const uvs = uvAttr ? new Float32Array(uvAttr.array as ArrayLike<number>).slice(0, uvAttr.count * 2) : undefined;
    const cAttr = g.getAttribute("color");
    let colors: Float32Array | undefined;
    if (cAttr) {
      colors = new Float32Array(cAttr.count * 4);
      for (let i = 0; i < cAttr.count; i++) colors.set([cAttr.getX(i), cAttr.getY(i), cAttr.getZ(i), cAttr.itemSize === 4 ? cAttr.getW(i) : 1], i * 4);
    }
    const allIndices = g.index ? Uint32Array.from(g.index.array as ArrayLike<number>) : Uint32Array.from({ length: pos.count }, (_, i) => i);
    // Mirrored transforms flip winding; restore it so faces stay outward.
    if (mesh.matrixWorld.determinant() < 0) {
      for (let i = 0; i < allIndices.length; i += 3) [allIndices[i + 1], allIndices[i + 2]] = [allIndices[i + 2]!, allIndices[i + 1]!];
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: allIndices.length, materialIndex: 0 }];
    const primitives = [];
    for (const grp of groups) {
      const slice = allIndices.subarray(grp.start, grp.start + grp.count);
      if (!slice.length) continue;
      const mat = mats[grp.materialIndex ?? 0] ?? mats[0]!;
      triangles += Math.floor(slice.length / 3);
      primitives.push({
        positions,
        normals,
        uvs,
        colors,
        indices: positions.length / 3 > 65535 ? Uint32Array.from(slice) : Uint16Array.from(slice),
        material: await materialFor(mat),
      });
    }
    if (!primitives.length) continue;
    meshes.push({ name: mesh.name || undefined, primitives });
    nodes.push({ name: mesh.name || `mesh-${meshes.length}`, mesh: meshes.length - 1 });
    nodes[0]!.children!.push(nodes.length - 1);
  }

  if (!meshes.length) throw new Error("The FBX file contains no meshes.");
  if (skinned) warnings.push("The FBX has a rig. The preview shows the bind pose; download the original FBX for the rig.");
  if (group.animations.length) warnings.push(`${group.animations.length} animation clip(s) were not converted; they remain in the original FBX.`);
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3());
  if (Math.max(size.x, size.y, size.z) > 100) warnings.push("The model is over 100 units across; the source may be in centimetres.");

  const glb = writeGlb({ meshes, materials, images, nodes, roots: [0], generator: "LOWPO11Y FBX converter (three.js FBXLoader)" });
  return { glb, warnings, meshes: meshes.length, triangles, textures };
}
