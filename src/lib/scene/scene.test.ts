import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import {
  addAsset,
  addNode,
  commit,
  copyNodes,
  duplicateNodes,
  effective,
  groupNodes,
  makeModel,
  makePrimitive,
  pasteNodes,
  redo,
  removeNodes,
  reorder,
  reparent,
  setTransform,
  snapTransform,
  startHistory,
  undo,
  ungroup,
  updateNodes,
  worldMatrix,
} from "./editor";
import { emptyScene, IDENTITY, parseScene, SceneFileError, serialiseScene, usedAssets, type SceneDoc, type Transform } from "./schema";

const world = (doc: SceneDoc, id: string) => new Vector3().setFromMatrixPosition(worldMatrix(doc, id)).toArray().map((v) => Math.round(v * 1e4) / 1e4);

function sample() {
  let doc = emptyScene("Test");
  const a = addAsset(doc, { kind: "model", source: "library", name: "crate.glb", slug: "demo-wooden-crate", fileId: "00000000-0000-4000-8000-000000000001", licence: "CC0" });
  doc = a.doc;
  const crate = makeModel(doc.assets[0]!, [2, 0, 0]);
  const box = makePrimitive("box", [0, 0, -3]);
  doc = addNode(addNode(doc, crate), box);
  return { doc, crate, box, asset: a.id };
}

describe("scene files", () => {
  it("round-trip through JSON with identical transforms", () => {
    const { doc, crate } = sample();
    const t: Transform = { position: [1.25, 0.5, -7], rotation: [0, 33.3333, 90], scale: [2, 2, 0.5] };
    const moved = setTransform(doc, crate.id, t);
    const back = parseScene(serialiseScene(moved));
    expect(back.notes).toEqual([]);
    expect(back.doc).toEqual(moved);
    expect(back.doc.nodes.find((n) => n.id === crate.id)!.transform).toEqual(t);
    // Saving the reopened scene gives the same bytes, whatever order edits left the keys in.
    expect(serialiseScene(back.doc)).toBe(serialiseScene(moved));
    expect(serialiseScene(updateNodes(moved, [crate.id], (n) => ({ name: n.name })))).toBe(serialiseScene(moved));
  });

  it("save only the assets in use", () => {
    let { doc } = sample();
    doc = addAsset(doc, { kind: "texture", source: "local", name: "unused.png", sha256: "a".repeat(64) }).doc;
    expect(doc.assets).toHaveLength(2);
    expect(usedAssets(doc).map((a) => a.name)).toEqual(["crate.glb"]);
    expect(JSON.parse(serialiseScene(doc)).assets).toHaveLength(1);
  });

  it("repair duplicate ids, orphans, loops and missing assets, and say so", () => {
    const { doc } = parseScene({
      format: "lowpo11y-scene",
      version: 1,
      nodes: [
        { id: "a", name: "A", parent: "b", type: "group" },
        { id: "b", name: "B", parent: "a", type: "group" },
        { id: "c", name: "C", parent: "nowhere", type: "group" },
        { id: "c", name: "C again", parent: null, type: "primitive" },
        { id: "m", name: "Lost model", parent: null, type: "model", asset: "gone" },
        { id: "bad", type: "teapot" },
      ],
    });
    const parsed = parseScene({ format: "lowpo11y-scene", version: 1, nodes: doc.nodes, assets: [] });
    expect(new Set(doc.nodes.map((n) => n.id)).size).toBe(doc.nodes.length);
    expect(doc.nodes.find((n) => n.name === "C")!.parent).toBeNull();
    expect(doc.nodes.some((n) => n.parent === null && (n.name === "A" || n.name === "B"))).toBe(true);
    expect(doc.nodes.find((n) => n.name === "C again")!.primitive?.shape).toBe("box");
    expect(parsed.notes.join(" ")).toMatch(/Lost model.*placeholder/);
  });

  it("refuse other files and newer versions; clamp nonsense values", () => {
    expect(() => parseScene("nope")).toThrow(/valid JSON/);
    expect(() => parseScene({ format: "x", version: 1, nodes: [] })).toThrow(SceneFileError);
    expect(() => parseScene({ format: "lowpo11y-scene", version: 2, nodes: [] })).toThrow(/newer Scene Builder/);
    const { doc } = parseScene({ format: "lowpo11y-scene", version: 1, nodes: [{ id: "n", type: "group", transform: { position: [1, "x", Infinity], rotation: [0, 0, 0], scale: [0, 1, 1] } }], settings: { fog: { near: -5 } } });
    expect(doc.nodes[0]!.transform.position).toEqual([1, 0, 0]);
    expect(doc.nodes[0]!.transform.scale[0]).toBeGreaterThan(0);
    expect(doc.settings.fog.near).toBe(8);
  });
});

describe("editing", () => {
  it("groups, reparents and ungroups without moving anything in the world", () => {
    const s0 = sample();
    const { crate, box } = s0;
    let doc = s0.doc;
    doc = setTransform(doc, crate.id, { position: [2, 0, 0], rotation: [0, 90, 0], scale: [1, 1, 1] });
    const before = [world(doc, crate.id), world(doc, box.id)];
    const g = groupNodes(doc, [crate.id, box.id], "Props");
    doc = g.doc;
    expect(doc.nodes.filter((n) => n.parent === g.id).map((n) => n.id)).toEqual([crate.id, box.id]);
    // Move the group: children follow in the world, keep their local transforms.
    doc = setTransform(doc, g.id, { position: [10, 0, 0], rotation: [0, 45, 0], scale: [2, 2, 2] });
    const movedCrate = world(doc, crate.id);
    expect(movedCrate).not.toEqual(before[0]);
    // Reparent to the top level: stays where it is.
    doc = reparent(doc, [crate.id], null);
    expect(world(doc, crate.id)).toEqual(movedCrate);
    // Ungroup: the box stays where it is too.
    const boxWorld = world(doc, box.id);
    doc = ungroup(doc, g.id);
    expect(doc.nodes.find((n) => n.id === g.id)).toBeUndefined();
    expect(world(doc, box.id)).toEqual(boxWorld);
    expect(() => reparent(groupNodes(doc, [box.id]).doc, [doc.nodes[0]!.id], doc.nodes[0]!.id)).not.toThrow();
  });

  it("refuses to put an object inside itself", () => {
    const { doc, crate } = sample();
    const g = groupNodes(doc, [crate.id]);
    expect(() => reparent(g.doc, [g.id], crate.id)).toThrow(/inside itself/);
  });

  it("duplicates with children, fresh ids and an offset", () => {
    const { doc, crate, box } = sample();
    const g = groupNodes(doc, [crate.id, box.id]);
    const d = duplicateNodes(g.doc, [g.id], [0, 0, 5]);
    expect(d.ids).toHaveLength(1);
    const copyKids = d.doc.nodes.filter((n) => n.parent === d.ids[0]);
    expect(copyKids).toHaveLength(2);
    expect(new Set(d.doc.nodes.map((n) => n.id)).size).toBe(d.doc.nodes.length);
    const copyCrate = copyKids.find((n) => n.type === "model")!;
    expect(world(d.doc, copyCrate.id)).toEqual([2, 0, 5]);
    expect(d.doc.nodes.find((n) => n.id === d.ids[0])!.name).toBe("Group 2");
  });

  it("gives every copy its own name when several are duplicated at once", () => {
    const { doc, crate } = sample();
    const once = duplicateNodes(doc, [crate.id]);
    const twice = duplicateNodes(once.doc, [crate.id, once.ids[0]!]);
    expect(twice.ids.map((id) => twice.doc.nodes.find((n) => n.id === id)!.name)).toEqual(["crate 3", "crate 4"]);
  });

  it("copies and pastes as world-space top-level objects with their assets", () => {
    const { doc, crate } = sample();
    const g = groupNodes(doc, [crate.id]);
    const moved = setTransform(g.doc, g.id, { position: [0, 1, 0], rotation: [0, 0, 0], scale: [1, 1, 1] });
    const clip = copyNodes(moved, [crate.id]);
    expect(clip.assets.map((a) => a.name)).toEqual(["crate.glb"]);
    const fresh = emptyScene();
    const p = pasteNodes(fresh, clip, [0, 0, 0]);
    expect(p.doc.assets).toHaveLength(1);
    expect(world(p.doc, p.ids[0]!)).toEqual([2, 1, 0]);
    expect(p.doc.nodes[0]!.asset).toBe(p.doc.assets[0]!.id);
  });

  it("removes subtrees, reorders siblings and resolves hidden/locked through parents", () => {
    const s0 = sample();
    const { crate, box } = s0;
    let doc = s0.doc;
    const g = groupNodes(doc, [crate.id, box.id]);
    doc = updateNodes(g.doc, [g.id], () => ({ visible: false, locked: true }));
    expect(effective(doc, crate.id)).toEqual({ visible: false, locked: true });
    doc = reorder(doc, box.id, -1);
    expect(doc.nodes.filter((n) => n.parent === g.id).map((n) => n.id)).toEqual([box.id, crate.id]);
    expect(removeNodes(doc, [g.id]).nodes).toEqual([]);
  });

  it("reuses an asset entry for the same file", () => {
    const { doc } = sample();
    const again = addAsset(doc, { kind: "model", source: "library", name: "crate.glb", fileId: "00000000-0000-4000-8000-000000000001" });
    expect(again.doc).toBe(doc);
    expect(again.id).toBe(doc.assets[0]!.id);
  });

  it("snaps position, rotation and scale to the grid settings", () => {
    expect(snapTransform({ position: [0.26, 1.74, -0.24], rotation: [7, 23, 181], scale: [1.04, 0.96, 2.02] }, { snap: 0.5, angle: 15, scale: 0.1 })).toEqual({
      position: [0.5, 1.5, 0],
      rotation: [0, 30, 180],
      scale: [1, 1, 2],
    });
  });
});

describe("history", () => {
  it("undoes and redoes, labels each step, and drops redo after a new edit", () => {
    const { doc, crate } = sample();
    let h = startHistory(doc);
    const moved = setTransform(doc, crate.id, { position: [9, 9, 9], rotation: [0, 0, 0], scale: [1, 1, 1] });
    h = commit(h, moved, "Move Crate");
    h = commit(h, removeNodes(moved, [crate.id]), "Delete Crate");
    expect(h.label).toBe("Delete Crate");
    h = undo(h);
    expect(h.present).toBe(moved);
    expect(h.label).toBe("Move Crate");
    h = undo(h);
    expect(h.present).toBe(doc);
    expect(undo(h)).toBe(h);
    h = redo(h);
    expect(h.present).toBe(moved);
    h = commit(h, reorder(moved, crate.id, 1), "Reorder");
    expect(h.future).toEqual([]);
    expect(commit(h, h.present, "Nothing")).toBe(h);
  });

  it("folds a run of edits with the same merge key into one undo step", () => {
    const { doc, crate } = sample();
    let h = startHistory(doc);
    for (const x of [1, 2, 3]) h = commit(h, setTransform(h.present, crate.id, { position: [x, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }), "Move Crate", "pos:1");
    expect(h.past).toHaveLength(1);
    h = commit(h, setTransform(h.present, crate.id, { position: [4, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }), "Move Crate", "pos:2");
    expect(h.past).toHaveLength(2);
    h = undo(undo(h));
    expect(h.present).toBe(doc);
    // After an undo the next edit starts a new step even with the old key.
    h = redo(h);
    h = commit(h, setTransform(h.present, crate.id, IDENTITY), "Reset", "pos:1");
    expect(h.past).toHaveLength(2);
  });
});
