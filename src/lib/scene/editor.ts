/**
 * Scene editing as pure functions over the document: every edit returns a
 * new SceneDoc (the old one is untouched), so undo/redo is a stack of
 * snapshots and the three.js view just follows the current document.
 * Reparenting, grouping and ungrouping keep each object where it is in the
 * world. Uses three.js's math classes only (no rendering).
 */
import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from "three";
import { IDENTITY, materialSchema, newId, primitiveSchema, type AssetRef, type PrimitiveShape, type SceneDoc, type SceneNode, type SceneSettings, type Transform, type Vec3 } from "./schema";

/* ------------------------------------------------------------- queries */

export const byId = (doc: SceneDoc) => new Map(doc.nodes.map((n) => [n.id, n]));
export const childrenOf = (doc: SceneDoc, parent: string | null) => doc.nodes.filter((n) => n.parent === parent);

/** The node and everything under it, in document order. */
export function subtree(doc: SceneDoc, ids: string[]): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of doc.nodes)
      if (n.parent && out.has(n.parent) && !out.has(n.id)) {
        out.add(n.id);
        grew = true;
      }
  }
  return out;
}

/** Selected ids without the ones already covered by a selected ancestor. */
export function topLevel(doc: SceneDoc, ids: string[]): string[] {
  const m = byId(doc);
  const set = new Set(ids);
  return ids.filter((id) => {
    let p = m.get(id)?.parent ?? null;
    while (p) {
      if (set.has(p)) return false;
      p = m.get(p)?.parent ?? null;
    }
    return m.has(id);
  });
}

/** Hidden or locked through any ancestor. */
export function effective(doc: SceneDoc, id: string): { visible: boolean; locked: boolean } {
  const m = byId(doc);
  let n = m.get(id);
  let visible = true,
    locked = false;
  while (n) {
    visible &&= n.visible;
    locked ||= n.locked;
    n = n.parent ? m.get(n.parent) : undefined;
  }
  return { visible, locked };
}

/* ---------------------------------------------------------------- math */

export function toMatrix(t: Transform): Matrix4 {
  const q = new Quaternion().setFromEuler(new Euler(...(t.rotation.map((d) => MathUtils.degToRad(d)) as Vec3), "XYZ"));
  return new Matrix4().compose(new Vector3(...t.position), q, new Vector3(...t.scale));
}

const clean = (v: number) => {
  const r = Math.round(v * 1e6) / 1e6;
  return Object.is(r, -0) ? 0 : r;
};

export function fromMatrix(m: Matrix4): Transform {
  const p = new Vector3(),
    q = new Quaternion(),
    s = new Vector3();
  m.decompose(p, q, s);
  const e = new Euler().setFromQuaternion(q, "XYZ");
  return {
    position: [clean(p.x), clean(p.y), clean(p.z)],
    rotation: [clean(MathUtils.radToDeg(e.x)), clean(MathUtils.radToDeg(e.y)), clean(MathUtils.radToDeg(e.z))],
    scale: [clean(s.x), clean(s.y), clean(s.z)],
  };
}

export function worldMatrix(doc: SceneDoc, id: string | null): Matrix4 {
  const m = byId(doc);
  const out = new Matrix4();
  let n = id ? m.get(id) : undefined;
  while (n) {
    out.premultiply(toMatrix(n.transform));
    n = n.parent ? m.get(n.parent) : undefined;
  }
  return out;
}

/* --------------------------------------------------------------- edits */

const replace = (doc: SceneDoc, nodes: SceneNode[]): SceneDoc => ({ ...doc, nodes });

export function addNode(doc: SceneDoc, node: SceneNode, index?: number): SceneDoc {
  const nodes = [...doc.nodes];
  nodes.splice(index ?? nodes.length, 0, node);
  return replace(doc, nodes);
}

export function makeModel(asset: AssetRef, at: Vec3 = [0, 0, 0]): SceneNode {
  return { id: newId(), name: asset.name.replace(/\.(glb|gltf)$/i, ""), parent: null, type: "model", visible: true, locked: false, transform: { ...IDENTITY, position: at }, asset: asset.id };
}

export function makePrimitive(shape: PrimitiveShape, at: Vec3 = [0, 0, 0]): SceneNode {
  const size = shape === "plane" ? { width: 4, height: 0.001, depth: 4 } : { width: 1, height: 1, depth: 1 };
  const y = shape === "plane" ? 0 : 0.5;
  return {
    id: newId(),
    name: shape === "box" ? "Box" : shape === "plane" ? "Plane" : "Cylinder",
    parent: null,
    type: "primitive",
    visible: true,
    locked: false,
    transform: { ...IDENTITY, position: [at[0], at[1] + y, at[2]] },
    primitive: primitiveSchema.parse({ shape, ...size }),
    material: materialSchema.parse({}),
  };
}

export function updateNodes(doc: SceneDoc, ids: string[], patch: (n: SceneNode) => Partial<SceneNode>): SceneDoc {
  const set = new Set(ids);
  return replace(
    doc,
    doc.nodes.map((n) => (set.has(n.id) ? { ...n, ...patch(n) } : n)),
  );
}

export const setTransform = (doc: SceneDoc, id: string, t: Transform) => updateNodes(doc, [id], () => ({ transform: t }));

/** Removes the objects and everything inside them. */
export function removeNodes(doc: SceneDoc, ids: string[]): SceneDoc {
  const gone = subtree(doc, ids);
  return replace(
    doc,
    doc.nodes.filter((n) => !gone.has(n.id)),
  );
}

/** Copies of the objects (with their children), offset in world space; returns the new top-level ids. */
export function duplicateNodes(doc: SceneDoc, ids: string[], offset: Vec3 = [0, 0, 0]): { doc: SceneDoc; ids: string[] } {
  const tops = topLevel(doc, ids);
  const all = subtree(doc, tops);
  const map = new Map<string, string>();
  for (const id of all) map.set(id, newId());
  const copies: SceneNode[] = [];
  const taken = new Set(doc.nodes.map((n) => n.name));
  for (const n of doc.nodes) {
    if (!all.has(n.id)) continue;
    const top = tops.includes(n.id);
    let transform = n.transform;
    if (top && (offset[0] || offset[1] || offset[2])) {
      const parentWorld = worldMatrix(doc, n.parent);
      const world = parentWorld.clone().multiply(toMatrix(n.transform));
      world.premultiply(new Matrix4().makeTranslation(...offset));
      transform = fromMatrix(parentWorld.clone().invert().multiply(world));
    }
    copies.push({ ...structuredClone(n), id: map.get(n.id)!, parent: top ? n.parent : map.get(n.parent!)!, name: top ? copyName(taken, n.name) : n.name, transform, locked: false });
  }
  // Each copy goes right after its original's subtree.
  let nodes = [...doc.nodes];
  for (const top of tops) {
    const block = copies.filter((c) => subtree({ ...doc, nodes: copies }, [map.get(top)!]).has(c.id));
    const lastIndex = Math.max(...[...subtree(doc, [top])].map((id) => nodes.findIndex((n) => n.id === id)));
    nodes = [...nodes.slice(0, lastIndex + 1), ...block, ...nodes.slice(lastIndex + 1)];
  }
  return { doc: replace(doc, nodes), ids: tops.map((t) => map.get(t)!) };
}

/** "Crate" → "Crate 2", or the next free number; the name is then taken. */
function copyName(taken: Set<string>, name: string): string {
  const base = name.replace(/ \d+$/, "");
  for (let i = 2; ; i++)
    if (!taken.has(`${base} ${i}`)) {
      taken.add(`${base} ${i}`);
      return `${base} ${i}`;
    }
}

/** Moves objects under a new parent (or the top level), keeping where they are in the world. */
export function reparent(doc: SceneDoc, ids: string[], parent: string | null): SceneDoc {
  const tops = topLevel(doc, ids).filter((id) => id !== parent);
  if (parent && subtree(doc, tops).has(parent)) throw new Error("An object can't go inside itself.");
  const parentInv = worldMatrix(doc, parent).invert();
  const world = new Map(tops.map((id) => [id, worldMatrix(doc, id)]));
  const moved = new Set(tops);
  // Moved objects go to the end of their new parent's children, in their current order.
  const rest = doc.nodes.filter((n) => !moved.has(n.id));
  const picked = doc.nodes.filter((n) => moved.has(n.id)).map((n) => ({ ...n, parent, transform: fromMatrix(parentInv.clone().multiply(world.get(n.id)!)) }));
  return replace(doc, [...rest, ...picked]);
}

/** Puts objects into a new group at their lowest common level; returns the group's id. */
export function groupNodes(doc: SceneDoc, ids: string[], name = "Group"): { doc: SceneDoc; id: string } {
  const tops = topLevel(doc, ids);
  if (!tops.length) return { doc, id: "" };
  const m = byId(doc);
  const parents = new Set(tops.map((id) => m.get(id)!.parent));
  const parent = parents.size === 1 ? [...parents][0]! : null;
  const group: SceneNode = { id: newId(), name, parent, type: "group", visible: true, locked: false, transform: IDENTITY };
  const at = Math.min(...tops.map((id) => doc.nodes.findIndex((n) => n.id === id)));
  const withGroup = addNode(doc, group, at);
  return { doc: reparent(withGroup, tops, group.id), id: group.id };
}

/** Removes a group, keeping its children where they are in the world. */
export function ungroup(doc: SceneDoc, groupId: string): SceneDoc {
  const g = byId(doc).get(groupId);
  if (!g || g.type !== "group") return doc;
  const kids = childrenOf(doc, groupId).map((n) => n.id);
  return removeNodes(reparent(doc, kids, g.parent), [groupId]);
}

/** Moves an object one place up or down among its siblings. */
export function reorder(doc: SceneDoc, id: string, dir: -1 | 1): SceneDoc {
  const n = byId(doc).get(id);
  if (!n) return doc;
  const sibs = doc.nodes.filter((x) => x.parent === n.parent);
  const i = sibs.indexOf(n),
    j = i + dir;
  if (j < 0 || j >= sibs.length) return doc;
  const a = doc.nodes.indexOf(sibs[i]!),
    b = doc.nodes.indexOf(sibs[j]!);
  const nodes = [...doc.nodes];
  [nodes[a], nodes[b]] = [nodes[b]!, nodes[a]!];
  return replace(doc, nodes);
}

/** Adds an asset to the manifest, reusing an existing entry for the same file. Returns its id. */
export function addAsset(doc: SceneDoc, a: Omit<AssetRef, "id">): { doc: SceneDoc; id: string } {
  const same = doc.assets.find((x) => x.kind === a.kind && ((a.fileId && x.fileId === a.fileId) || (a.sha256 && x.sha256 === a.sha256)));
  if (same) return { doc, id: same.id };
  const id = `a-${(a.sha256 ?? a.fileId ?? newId()).slice(0, 12)}-${doc.assets.length}`;
  return { doc: { ...doc, assets: [...doc.assets, { ...a, id }] }, id };
}

export function setSettings(doc: SceneDoc, patch: (s: SceneSettings) => SceneSettings): SceneDoc {
  return { ...doc, settings: patch(structuredClone(doc.settings)) };
}

/* --------------------------------------------------------- clipboard */

export interface Clip {
  nodes: SceneNode[];
  assets: AssetRef[];
}

/** The selected objects with their children, as world-space top-level copies. */
export function copyNodes(doc: SceneDoc, ids: string[]): Clip {
  const tops = topLevel(doc, ids);
  const all = subtree(doc, tops);
  const nodes = doc.nodes.filter((n) => all.has(n.id)).map((n) => (tops.includes(n.id) ? { ...structuredClone(n), parent: null, transform: fromMatrix(worldMatrix(doc, n.id)) } : structuredClone(n)));
  const used = new Set(nodes.flatMap((n) => [n.asset, n.material?.texture].filter((x): x is string => !!x)));
  return { nodes, assets: doc.assets.filter((a) => used.has(a.id)) };
}

export function pasteNodes(doc: SceneDoc, clip: Clip, offset: Vec3 = [0.5, 0, 0.5]): { doc: SceneDoc; ids: string[] } {
  let d = doc;
  const assetMap = new Map<string, string>();
  for (const a of clip.assets) {
    const r = addAsset(d, a);
    d = r.doc;
    assetMap.set(a.id, r.id);
  }
  const idMap = new Map(clip.nodes.map((n) => [n.id, newId()]));
  const tops: string[] = [];
  const nodes = clip.nodes.map((n) => {
    const top = !n.parent || !idMap.has(n.parent);
    const id = idMap.get(n.id)!;
    if (top) tops.push(id);
    const p = n.transform.position;
    return {
      ...structuredClone(n),
      id,
      parent: top ? null : idMap.get(n.parent!)!,
      asset: n.asset ? (assetMap.get(n.asset) ?? n.asset) : undefined,
      material: n.material ? { ...n.material, texture: n.material.texture ? (assetMap.get(n.material.texture) ?? null) : null } : undefined,
      transform: top ? { ...n.transform, position: [p[0] + offset[0], p[1] + offset[1], p[2] + offset[2]] as Vec3 } : n.transform,
    };
  });
  return { doc: { ...d, nodes: [...d.nodes, ...nodes] }, ids: tops };
}

/* ------------------------------------------------------------ history */

export interface History {
  past: { doc: SceneDoc; label: string }[];
  present: SceneDoc;
  future: { doc: SceneDoc; label: string }[];
  /** What the next undo reverts. */
  label: string | null;
  /** Consecutive edits with the same key (a slider drag, a number scrub) are one undo step. */
  merge?: string | null;
}

export const HISTORY_LIMIT = 200;

export const startHistory = (doc: SceneDoc): History => ({ past: [], present: doc, future: [], label: null });

/** Records an edit. No-op edits (same document) aren't recorded; an edit with the previous edit's merge key replaces it. */
export function commit(h: History, doc: SceneDoc, label: string, merge?: string): History {
  if (doc === h.present) return h;
  if (merge && h.merge === merge) return { ...h, present: doc, future: [], label };
  return { past: [...h.past, { doc: h.present, label: h.label ?? "" }].slice(-HISTORY_LIMIT), present: doc, future: [], label, merge: merge ?? null };
}

export function undo(h: History): History {
  const prev = h.past.at(-1);
  if (!prev) return h;
  return { past: h.past.slice(0, -1), present: prev.doc, future: [{ doc: h.present, label: h.label ?? "" }, ...h.future], label: prev.label || null, merge: null };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return { past: [...h.past, { doc: h.present, label: h.label ?? "" }], present: next.doc, future: h.future.slice(1), label: next.label || null, merge: null };
}

/* ------------------------------------------------------------- snapping */

export const snapValue = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

export function snapTransform(t: Transform, s: SceneSettings["grid"]): Transform {
  const r = (v: number) => clean(v);
  return {
    position: t.position.map((v) => r(snapValue(v, s.snap))) as Vec3,
    rotation: t.rotation.map((v) => r(snapValue(v, s.angle))) as Vec3,
    scale: t.scale.map((v) => r(snapValue(v, s.scale) || v)) as Vec3,
  };
}
