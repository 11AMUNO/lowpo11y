import { describe, expect, it } from "vitest";
import { parseCsv, parseManifest, planFromPaths, purposeFor, titleFromName } from "./import";

const tripo = (folder: string, id: string) => [`${folder}/tripo_convert_${id}.fbx`, `${folder}/tripo_convert_${id}.fbm/tripo_image_${id}_0_0.jpg`];

describe("titleFromName", () => {
  it("keeps set codes and tidies names", () => {
    expect(titleFromName("BH-01-Bed")).toEqual({ title: "BH-01 Bed", setCode: "BH-01" });
    expect(titleFromName("BH+-+07+-+Animals")).toEqual({ title: "BH-07 Animals", setCode: "BH-07" });
    expect(titleFromName("BH-11-foodtruck").title).toBe("BH-11 Foodtruck");
    expect(titleFromName("01 - Walnut Cupboard Light Wear")).toEqual({ title: "Walnut Cupboard Light Wear", setCode: null });
    expect(titleFromName("rusty_pipe-elbow").title).toBe("Rusty pipe elbow");
  });
});

describe("planFromPaths", () => {
  it("makes one model asset per folder, keeping the FBX texture folder with it", () => {
    const paths = [...tripo("03/BH-03-Barrier", "aaa"), ...tripo("03/BH-03-Barrier (1)", "bbb"), ...tripo("07/BH+-+07+-+Animals", "ccc"), "03/.DS_Store", "__MACOSX/03/._x"];
    const { entries, ignored } = planFromPaths(paths, { provenance: "ai_assisted", tags: ["tripo"] });
    expect(entries.map((e) => [e.title, e.slug, e.type, e.files.length])).toEqual([
      ["BH-03 Barrier", "bh-03-barrier", "model", 2],
      ["BH-03 Barrier (1)", "bh-03-barrier-1", "model", 2],
      ["BH-07 Animals", "bh-07-animals", "model", 2],
    ]);
    expect(entries[0]!.primary).toBe("03/BH-03-Barrier/tripo_convert_aaa.fbx");
    expect(entries[0]!.tags).toEqual(["tripo", "bh-03"]);
    expect(entries[0]!.provenance).toBe("ai_assisted");
    expect(ignored).toEqual(expect.arrayContaining(["03/.DS_Store", "__MACOSX/03/._x"]));
  });

  it("makes one texture asset per loose image", () => {
    const { entries } = planFromPaths(["wood/01 - Walnut Cupboard Light Wear.png", "wood/02 - Honey Oak Door.png"], { category: "wood" });
    expect(entries.map((e) => [e.title, e.type, e.category, e.files])).toEqual([
      ["Walnut Cupboard Light Wear", "texture", "wood", ["wood/01 - Walnut Cupboard Light Wear.png"]],
      ["Honey Oak Door", "texture", "wood", ["wood/02 - Honey Oak Door.png"]],
    ]);
  });

  it("splits several models in one folder by name", () => {
    const { entries } = planFromPaths(["props/crate.fbx", "props/crate_diffuse.png", "props/barrel.glb", "props/barrel.png", "props/readme.txt"]);
    expect(entries.map((e) => [e.title, e.files])).toEqual([
      ["Barrel", ["props/barrel.glb", "props/barrel.png"]],
      ["Crate", ["props/crate.fbx", "props/crate_diffuse.png"]],
    ]);
  });
});

describe("purposeFor", () => {
  it("routes thumbnails and project files", () => {
    expect(purposeFor("a/crate-thumb.png")).toBe("thumbnail");
    expect(purposeFor("a/crate.blend")).toBe("source");
    expect(purposeFor("a/crate.fbx")).toBe("delivery");
  });
});

describe("manifests", () => {
  it("parses quoted CSV", () => {
    expect(parseCsv('title,files\n"Crate, wooden","a.glb;b.png"\r\n\nLamp,c.glb\n')).toEqual([
      ["title", "files"],
      ["Crate, wooden", "a.glb;b.png"],
      ["Lamp", "c.glb"],
    ]);
  });

  it("reads CSV rows into entries and reports bad rows", () => {
    const m = parseManifest("title,type,files,licence,tags\nCrate,model,crate.glb;crate.png,cc0-1.0,\"wood, prop\"\nX,spaceship,x.glb,,\n", "csv");
    expect(m.entries).toHaveLength(1);
    expect(m.entries[0]).toMatchObject({ title: "Crate", type: "model", files: ["crate.glb", "crate.png"], licence: "cc0-1.0", tags: ["wood", "prop"] });
    expect(m.problems[0]).toMatch(/^Row 2: /);
  });

  it("applies JSON defaults under each entry", () => {
    const m = parseManifest(JSON.stringify({ schema: "lowpo11y.import/1", defaults: { licence: "cc-by-4.0", tags: ["kit"] }, assets: [{ title: "Lamp", type: "model", files: ["lamp.glb"] }, { title: "Bin", type: "model", files: ["bin.glb"], licence: "cc0-1.0" }] }), "json");
    expect(m.entries.map((e) => [e.licence, e.tags])).toEqual([
      ["cc-by-4.0", ["kit"]],
      ["cc0-1.0", ["kit"]],
    ]);
    expect(parseManifest("{nope", "json").problems).toEqual(["The manifest isn't valid JSON."]);
  });
});

describe("applyDefaults", () => {
  it("fills unset fields and merges tags, keeping the entry's own values", async () => {
    const { applyDefaults } = await import("./import");
    const m = parseManifest(JSON.stringify([{ title: "Lamp", type: "model", files: ["lamp.glb"], licence: "cc0-1.0", tags: ["lamp"] }]), "json");
    const e = applyDefaults(m.entries[0]!, { licence: "cc-by-4.0", category: "props", tags: ["kit"] });
    expect(e).toMatchObject({ licence: "cc0-1.0", category: "props", tags: ["kit", "lamp"] });
  });
});
