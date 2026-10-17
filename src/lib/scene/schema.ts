/**
 * The Scene Builder's project file, `.retro-scene.json`: versioned JSON
 * with a node tree (stable UUIDs, parent links, array order = sibling
 * order), an asset dependency manifest (library files by id and slug, local
 * files by SHA-256), materials for blockout primitives, and scene settings
 * (lighting, fog, grid snapping, retro preview). `parseScene` validates
 * everything, repairs what it safely can (duplicate ids, orphans, parent
 * loops, missing assets) and says what it changed.
 */
import { z } from "zod";

export const SCENE_FORMAT = "lowpo11y-scene";
export const SCENE_VERSION = 1;

export type Vec3 = [number, number, number];
export type Vec2 = [number, number];

const finite = (min: number, max: number, d: number) => z.number().finite().min(min).max(max).catch(d);
const vec3 = (min: number, max: number, d: Vec3) => z.tuple([finite(min, max, d[0]), finite(min, max, d[1]), finite(min, max, d[2])]).catch(d);
const vec2 = (min: number, max: number, d: Vec2) => z.tuple([finite(min, max, d[0]), finite(min, max, d[1])]).catch(d);
const hex = (d: string) =>
  z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .transform((s) => s.toLowerCase())
    .catch(d);
const bool = (d: boolean) => z.boolean().catch(d);
const id = z.string().regex(/^[\w-]{1,64}$/);

export const transformSchema = z.object({
  position: vec3(-1e5, 1e5, [0, 0, 0]),
  /** Euler angles in degrees, XYZ order. */
  rotation: vec3(-36000, 36000, [0, 0, 0]),
  scale: vec3(-1000, 1000, [1, 1, 1]).transform((s) => s.map((v) => (Math.abs(v) < 1e-4 ? 1e-4 : v)) as Vec3),
});
export type Transform = z.infer<typeof transformSchema>;
export const IDENTITY: Transform = { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] };

export const materialSchema = z.object({
  color: hex("#bdbdbd"),
  /** An asset id of kind "texture", or null. */
  texture: id.nullable().catch(null),
  repeat: vec2(0.01, 1000, [1, 1]),
  offset: vec2(-1000, 1000, [0, 0]),
  roughness: finite(0, 1, 0.9),
  /** Nearest filtering keeps texels crisp, as in the retro tools. */
  pixelated: bool(true),
});
export type MaterialSpec = z.infer<typeof materialSchema>;

export const PRIMITIVES = ["box", "plane", "cylinder"] as const;
export type PrimitiveShape = (typeof PRIMITIVES)[number];

export const primitiveSchema = z.object({
  shape: z.enum(PRIMITIVES),
  width: finite(0.001, 10000, 1),
  height: finite(0.001, 10000, 1),
  depth: finite(0.001, 10000, 1),
  /** Radial segments for cylinders (the low-poly look lives here). */
  segments: z.number().int().min(3).max(64).catch(8),
});
export type PrimitiveSpec = z.infer<typeof primitiveSchema>;

export const assetRefSchema = z.object({
  id,
  kind: z.enum(["model", "texture"]),
  source: z.enum(["library", "local"]),
  /** File name, shown when the asset is missing. */
  name: z.string().trim().min(1).max(200),
  /** Library: the asset's slug and file id; the file is fetched through the normal download route. */
  slug: z.string().max(120).optional(),
  fileId: z.string().uuid().optional(),
  licence: z.string().max(80).nullable().optional(),
  /** Local files are matched by content when added again. */
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  bytes: z.number().int().min(0).optional(),
});
export type AssetRef = z.infer<typeof assetRefSchema>;

export const nodeSchema = z.object({
  id,
  name: z.string().trim().max(120).catch("Object"),
  parent: id.nullable().catch(null),
  type: z.enum(["group", "model", "primitive"]),
  visible: bool(true),
  locked: bool(false),
  transform: transformSchema.catch(IDENTITY),
  /** type "model": which asset. */
  asset: id.optional(),
  /** type "primitive". */
  primitive: primitiveSchema.optional(),
  material: materialSchema.optional(),
});
export type SceneNode = z.infer<typeof nodeSchema>;

export const settingsSchema = z.object({
  background: hex("#0b0b0b"),
  ambient: z.object({ color: hex("#ffffff"), intensity: finite(0, 10, 0.6) }).catch({ color: "#ffffff", intensity: 0.6 }),
  sun: z
    .object({
      color: hex("#ffffff"),
      intensity: finite(0, 20, 1.6),
      /** Compass direction the light comes from, degrees. */
      azimuth: finite(-360, 360, 35),
      elevation: finite(-90, 90, 50),
      shadows: bool(false),
    })
    .catch({ color: "#ffffff", intensity: 1.6, azimuth: 35, elevation: 50, shadows: false }),
  fog: z.object({ enabled: bool(false), color: hex("#0b0b0b"), near: finite(0, 1e4, 8), far: finite(0, 1e4, 40) }).catch({ enabled: false, color: "#0b0b0b", near: 8, far: 40 }),
  grid: z
    .object({
      /** Grid size and move snap, in metres (0 = no snap). */
      snap: finite(0, 100, 0.5),
      /** Rotation snap in degrees (0 = no snap). */
      angle: finite(0, 180, 15),
      /** Scale snap step (0 = no snap). */
      scale: finite(0, 10, 0.1),
    })
    .catch({ snap: 0.5, angle: 15, scale: 0.1 }),
  retro: z
    .object({
      enabled: bool(false),
      /** Internal render height in pixels. */
      height: z.number().int().min(120).max(1080).catch(240),
      /** Colour levels per channel (32 = PlayStation 15-bit). */
      levels: z.number().int().min(2).max(256).catch(32),
      dither: bool(true),
      /** Vertex snapping grid in rows (0 = off). */
      jitter: z.number().int().min(0).max(1080).catch(160),
    })
    .catch({ enabled: false, height: 240, levels: 32, dither: true, jitter: 160 }),
});
export type SceneSettings = z.infer<typeof settingsSchema>;
export const DEFAULT_SETTINGS: SceneSettings = settingsSchema.parse({});

export interface SceneDoc {
  format: typeof SCENE_FORMAT;
  version: typeof SCENE_VERSION;
  name: string;
  settings: SceneSettings;
  assets: AssetRef[];
  nodes: SceneNode[];
}

export class SceneFileError extends Error {}

export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);

export function emptyScene(name = "Untitled scene"): SceneDoc {
  return { format: SCENE_FORMAT, version: SCENE_VERSION, name, settings: structuredClone(DEFAULT_SETTINGS), assets: [], nodes: [] };
}

const MIGRATIONS: Record<number, (d: Record<string, unknown>) => Record<string, unknown>> = {};
export const MAX_NODES = 5000;

const fileSchema = z.object({
  format: z.literal(SCENE_FORMAT),
  version: z.number().int().min(1),
  name: z.string().trim().max(120).catch("Imported scene"),
  settings: z.unknown().optional(),
  assets: z.array(z.unknown()).max(2000).catch([]),
  nodes: z.array(z.unknown()).max(MAX_NODES),
});

/** Reads a scene file. Returns the scene and notes on anything repaired. */
export function parseScene(input: unknown): { doc: SceneDoc; notes: string[] } {
  let raw = input;
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input);
    } catch {
      throw new SceneFileError("That file isn't valid JSON.");
    }
  }
  if (!raw || typeof raw !== "object") throw new SceneFileError("That file isn't a LOWPO11Y scene.");
  let docIn = raw as Record<string, unknown>;
  if (docIn.format !== SCENE_FORMAT) throw new SceneFileError('That file isn\'t a LOWPO11Y scene (no "lowpo11y-scene" format marker).');
  const version = typeof docIn.version === "number" ? docIn.version : NaN;
  if (!Number.isInteger(version) || version < 1) throw new SceneFileError("The scene's version is missing or invalid.");
  if (version > SCENE_VERSION) throw new SceneFileError(`This scene was saved by a newer Scene Builder (format ${version}; this one reads up to ${SCENE_VERSION}).`);
  const notes: string[] = [];
  for (let v = version; v < SCENE_VERSION; v++) {
    docIn = MIGRATIONS[v]!(docIn);
    notes.push(`Upgraded from format ${v} to ${v + 1}.`);
  }
  const f = fileSchema.safeParse(docIn);
  if (!f.success) throw new SceneFileError(`The scene's structure isn't valid: ${f.error.issues[0]?.message ?? "unknown problem"}.`);

  const assets: AssetRef[] = [];
  const assetIds = new Set<string>();
  for (const a of f.data.assets) {
    const r = assetRefSchema.safeParse(a);
    if (!r.success) {
      notes.push("Skipped an asset entry that wasn't valid.");
      continue;
    }
    if (assetIds.has(r.data.id)) continue;
    assetIds.add(r.data.id);
    assets.push(r.data);
  }

  const nodes: SceneNode[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const n of f.data.nodes) {
    const r = nodeSchema.safeParse(n);
    if (!r.success) {
      dropped++;
      continue;
    }
    const node = r.data;
    if (seen.has(node.id)) {
      const fresh = newId();
      notes.push(`Two objects shared the id ${node.id}; one was given a new id.`);
      node.id = fresh;
    }
    seen.add(node.id);
    if (node.type === "model" && (!node.asset || !assetIds.has(node.asset))) {
      notes.push(`"${node.name}" refers to a model that isn't in the file's asset list; it shows as a placeholder.`);
    }
    if (node.type === "primitive" && !node.primitive) node.primitive = primitiveSchema.parse({ shape: "box" });
    if (node.type === "primitive" && !node.material) node.material = materialSchema.parse({});
    if (node.material?.texture && !assetIds.has(node.material.texture)) {
      notes.push(`"${node.name}" used a texture that isn't in the file; it was removed.`);
      node.material.texture = null;
    }
    nodes.push(node);
  }
  if (dropped) notes.push(`Skipped ${dropped} object${dropped > 1 ? "s" : ""} that weren't valid.`);

  // Parents must exist and must not loop.
  const ids = new Set(nodes.map((n) => n.id));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (n.parent && !ids.has(n.parent)) {
      notes.push(`"${n.name}" had a missing parent; it was moved to the top level.`);
      n.parent = null;
    }
  }
  for (const n of nodes) {
    const chain = new Set<string>([n.id]);
    let p = n.parent;
    while (p) {
      if (chain.has(p)) {
        notes.push(`"${n.name}" was inside itself; it was moved to the top level.`);
        n.parent = null;
        break;
      }
      chain.add(p);
      p = byId.get(p)?.parent ?? null;
    }
  }
  return {
    doc: { format: SCENE_FORMAT, version: SCENE_VERSION, name: f.data.name, settings: settingsSchema.parse(f.data.settings ?? {}), assets, nodes },
    notes,
  };
}

/** Assets no node uses are left out of saved files. */
export function usedAssets(doc: SceneDoc): AssetRef[] {
  const used = new Set<string>();
  for (const n of doc.nodes) {
    if (n.asset) used.add(n.asset);
    if (n.material?.texture) used.add(n.material.texture);
  }
  return doc.assets.filter((a) => used.has(a.id));
}

/** The file text. Canonical: every object goes through its schema, so keys always come in the same order and the same scene always saves to the same bytes. */
export function serialiseScene(doc: SceneDoc): string {
  return (
    JSON.stringify(
      {
        format: SCENE_FORMAT,
        version: SCENE_VERSION,
        name: doc.name,
        settings: settingsSchema.parse(doc.settings),
        assets: usedAssets(doc).map((a) => assetRefSchema.parse(a)),
        nodes: doc.nodes.map((n) => nodeSchema.parse(n)),
      },
      null,
      2,
    ) + "\n"
  );
}
