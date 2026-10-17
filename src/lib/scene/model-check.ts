/**
 * Checks a model file before the Scene Builder hands it to three.js:
 * format, size, required glTF extensions the site can't decode, external
 * files, and triangle budget. Everything else gets a plain explanation of
 * what to do instead (FBX, OBJ and .blend files are common and can't be
 * opened in the browser without conversion).
 */
import { gltfStats, parseGlb, parseGltfJson, type GltfStats } from "@/lib/formats/gltf";

export const MAX_MODEL_BYTES = 64 * 1024 * 1024;
/** Refused above this many triangles per model; warned above WARN_TRIANGLES. */
export const MAX_MODEL_TRIANGLES = 2_000_000;
export const WARN_TRIANGLES = 150_000;

export type ModelCheck = { ok: true; stats: GltfStats; warnings: string[] } | { ok: false; message: string };

const CONVERT = "Convert it to GLB first: in Blender, File → Import, then File → Export → glTF 2.0 (.glb).";

export function checkModelFile(name: string, bytes: Uint8Array): ModelCheck {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (["fbx", "obj", "blend", "dae", "3ds", "stl", "ply", "usdz", "usd", "max", "ma", "mb"].includes(ext)) {
    return { ok: false, message: `${ext.toUpperCase()} files can't be opened in the browser. ${CONVERT} For a library asset, the original is on its page.` };
  }
  if (ext !== "glb" && ext !== "gltf") return { ok: false, message: "Only GLB or glTF models can be added." };
  if (bytes.byteLength > MAX_MODEL_BYTES) return { ok: false, message: `This model is ${Math.round(bytes.byteLength / 1048576)} MB; the limit is ${MAX_MODEL_BYTES / 1048576} MB.` };
  let stats: GltfStats;
  try {
    if (ext === "glb") stats = gltfStats(parseGlb(bytes));
    else {
      const doc = parseGltfJson(new TextDecoder().decode(bytes));
      const external = [...(doc.json.buffers ?? []), ...(doc.json.images ?? [])].some((b: { uri?: string }) => b.uri && !b.uri.startsWith("data:"));
      if (external) return { ok: false, message: "This .glTF uses separate .bin or texture files. Export it as one .glb file instead." };
      stats = gltfStats(doc);
    }
  } catch (e) {
    return { ok: false, message: `This file isn't a readable glTF model${e instanceof Error && e.message ? ` (${e.message})` : ""}.` };
  }
  if (stats.unsupportedExtensions.length)
    return { ok: false, message: `This model needs ${stats.unsupportedExtensions.join(", ")}, which the Scene Builder can't decode. Re-export it without compression (no Draco, meshopt or KTX2).` };
  if (stats.sceneTriangles > MAX_MODEL_TRIANGLES) return { ok: false, message: `This model has ${stats.sceneTriangles.toLocaleString("en")} triangles; the limit is ${MAX_MODEL_TRIANGLES.toLocaleString("en")}. Decimate it first.` };
  const warnings: string[] = [];
  if (stats.sceneTriangles > WARN_TRIANGLES) warnings.push(`${stats.sceneTriangles.toLocaleString("en")} triangles: heavy for a low-poly scene, and the editor may slow down.`);
  if (!stats.meshes) warnings.push("This file has no meshes.");
  if (stats.skins || stats.animations.length) warnings.push("Animations and skinning are shown in their rest pose; the Scene Builder doesn't play them.");
  return { ok: true, stats, warnings };
}
