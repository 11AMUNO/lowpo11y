import { describe, expect, it } from "vitest";
import { renderDemoTexture } from "@/lib/demo/textures";
import { cloneImage, createImage, isPowerOfTwo, type RGBAImage } from "@/lib/processing/image";
import { convertRetro } from "@/lib/processing/retro";
import { CancelledError, GraphError, runGraph, SizedLru, topoOrder, type GraphNode } from "./graph";
import { fnv1a64, imageKey, stableStringify } from "./hash";
import { buildManifest, outputNames } from "./manifest";
import { emptyPipeline, newStep, parsePipeline, PipelineError, serialisePipeline, type Pipeline } from "./pipeline";
import { BUILTIN_PRESETS } from "./presets";
import { buildGraph, runPipeline, runTo, valueBytes, type WorkInput, type WorkValue } from "./run";
import { resizeTarget, STEPS } from "./steps";

const colours = (img: RGBAImage) => {
  const s = new Set<number>();
  for (let i = 0; i < img.data.length; i += 4) s.add((img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!);
  return s.size;
};

async function input(id: string, image: RGBAImage, name = `${id}.png`): Promise<WorkInput> {
  return { id, name, image, key: await imageKey(image) };
}

describe("graph executor", () => {
  const node = (id: string, deps: string[], run: (v: number[]) => number): GraphNode<number> => ({ id, deps, identity: id, run });

  it("orders nodes after their inputs and refuses loops and missing inputs", () => {
    expect(topoOrder([node("c", ["a", "b"], () => 0), node("a", [], () => 0), node("b", ["a"], () => 0)])).toEqual(["a", "b", "c"]);
    expect(() => topoOrder([node("a", ["b"], () => 0), node("b", ["a"], () => 0)])).toThrow(/loop/);
    expect(() => topoOrder([node("a", ["ghost"], () => 0)])).toThrow(GraphError);
  });

  it("computes only what the targets need, and reuses cached results", async () => {
    const runs: string[] = [];
    const n = (id: string, deps: string[], f: (v: number[]) => number) => node(id, deps, (v) => (runs.push(id), f(v)));
    const graph = [n("a", [], () => 2), n("b", ["a"], ([x]) => x! * 3), n("c", ["b"], ([x]) => x! + 1), n("side", ["a"], () => 99)];
    const cache = new SizedLru<number>(1e6, () => 8);
    expect((await runGraph(graph, ["c"], { cache })).get("c")).toBe(7);
    expect(runs).toEqual(["a", "b", "c"]);
    runs.length = 0;
    await runGraph(graph, ["c"], { cache });
    expect(runs).toEqual([]);
  });

  it("recomputes a cached value that was evicted mid-run", async () => {
    const tiny = new SizedLru<number>(16, () => 8); // holds two values
    const graph = [node("a", [], () => 1), node("b", ["a"], ([x]) => x! + 1), node("c", ["b"], ([x]) => x! + 1), node("d", ["c"], ([x]) => x! + 1)];
    expect((await runGraph(graph, ["d"], { cache: tiny })).get("d")).toBe(4);
    expect((await runGraph(graph, ["d"], { cache: tiny })).get("d")).toBe(4);
  });

  it("stops when cancelled", async () => {
    const ctrl = new AbortController();
    const graph = [node("a", [], () => (ctrl.abort(), 1)), node("b", ["a"], () => 2)];
    await expect(runGraph(graph, ["b"], { signal: ctrl.signal })).rejects.toBeInstanceOf(CancelledError);
  });

  it("hashes settings independently of key order", () => {
    expect(stableStringify({ b: 1, a: { d: [1, 2], c: null } })).toBe('{"a":{"c":null,"d":[1,2]},"b":1}');
    expect(fnv1a64(stableStringify({ x: 1, y: 2 }))).toBe(fnv1a64(stableStringify({ y: 2, x: 1 })));
    expect(fnv1a64("a")).not.toBe(fnv1a64("b"));
  });
});

describe("pipeline files", () => {
  it("round-trip through JSON", () => {
    const p = BUILTIN_PRESETS[0]!.build();
    const { pipeline, notes } = parsePipeline(serialisePipeline(p));
    expect(pipeline).toEqual(p);
    expect(notes).toEqual([]);
  });

  it("fill in missing or out-of-range settings and say so", () => {
    const { pipeline, notes } = parsePipeline({
      format: "lowpo11y-workshop",
      version: 1,
      name: "Old",
      steps: [{ type: "resize", params: { width: 64, height: 99999, extra: true } }],
    });
    expect(pipeline.steps[0]!.params).toMatchObject({ mode: "exact", width: 64, height: 128, sampling: "smooth" });
    expect(notes.join(" ")).toMatch(/"height" was missing or out of range/);
    expect(notes.join(" ")).toMatch(/unknown setting "extra"/);
    expect(pipeline.output).toEqual({ format: "png", quality: 90, naming: "{name}" });
  });

  it("refuse other files, unknown steps and newer versions", () => {
    expect(() => parsePipeline("{not json")).toThrow(/valid JSON/);
    expect(() => parsePipeline({ format: "something-else", version: 1, steps: [] })).toThrow(PipelineError);
    expect(() => parsePipeline({ format: "lowpo11y-workshop", version: 2, steps: [] })).toThrow(/newer version/);
    expect(() => parsePipeline({ format: "lowpo11y-workshop", version: 1, steps: [{ type: "explode" }] })).toThrow(/Unknown steps: explode/);
  });

  it("keep the atlas step last and give duplicate ids new ones", () => {
    const { pipeline, notes } = parsePipeline({
      format: "lowpo11y-workshop",
      version: 1,
      steps: [
        { id: "x", type: "atlas" },
        { id: "x", type: "crop" },
      ],
    });
    expect(pipeline.steps.map((s) => s.type)).toEqual(["crop", "atlas"]);
    expect(new Set(pipeline.steps.map((s) => s.id)).size).toBe(2);
    expect(notes).toContain("The atlas step was moved to the end (it always runs last).");
  });
});

describe("steps", () => {
  const src = renderDemoTexture("demo-red-brick", 96);

  it("never modify their input", () => {
    const before = cloneImage(src);
    for (const type of ["crop", "resize", "adjust", "alpha", "palette", "dither", "edge"] as const) {
      const def = STEPS[type];
      (def.run as (i: RGBAImage, p: unknown) => RGBAImage)(src, def.schema.parse({ padding: 4, bleed: true, grain: 5, brightness: 10 }));
    }
    expect(src.data).toEqual(before.data);
  });

  it("crop: centre square, rectangle clamped to the image, trim", () => {
    const wide = createImage(10, 4, [255, 0, 0, 255]);
    expect(STEPS.crop.run(wide, STEPS.crop.schema.parse({ mode: "square" }), {})).toMatchObject({ width: 4, height: 4 });
    expect(STEPS.crop.run(wide, STEPS.crop.schema.parse({ mode: "rect", x: 8, y: 1, width: 50, height: 50 }), {})).toMatchObject({ width: 2, height: 3 });
    const sprite = createImage(8, 8);
    sprite.data.set([255, 255, 255, 255], (3 * 8 + 2) * 4);
    expect(STEPS.crop.run(sprite, STEPS.crop.schema.parse({ mode: "trim" }), {})).toMatchObject({ width: 1, height: 1 });
  });

  it("resize: exact, long side, percentage and nearest power of two", () => {
    const p = (o: object) => STEPS.resize.schema.parse(o);
    expect(resizeTarget(300, 200, p({ mode: "exact", width: 64, height: 32 }))).toEqual([64, 32]);
    expect(resizeTarget(300, 200, p({ mode: "long", width: 150 }))).toEqual([150, 100]);
    expect(resizeTarget(300, 200, p({ mode: "scale", scale: 50 }))).toEqual([150, 100]);
    expect(resizeTarget(300, 200, p({ mode: "pot" }))).toEqual([256, 256]);
    expect(resizeTarget(90, 40, p({ mode: "pot" }))).toEqual([64, 32]);
  });

  it("use the same algorithms as the retro converter", () => {
    // Workshop resize + bit depth equals the converter with its palette off.
    const p: Pipeline = { ...emptyPipeline(), steps: [newStep("resize", { mode: "exact", width: 64, height: 48, fit: "crop", sampling: "smooth" }), newStep("adjust", { contrast: 20, saturation: -30 }), newStep("dither", { r: 5, g: 6, b: 5, dither: "bayer4", strength: 75 })] };
    const out = p.steps.reduce((img, s) => (STEPS[s.type as "resize"].run as (i: RGBAImage, q: unknown) => RGBAImage)(img, s.params), src);
    const tool = convertRetro(src, { sizeMode: "exact", width: 64, height: 48, fit: "crop", sampling: "smooth", contrast: 20, saturation: -30, bits: { r: 5, g: 6, b: 5 }, palette: "off", dither: "bayer4", ditherStrength: 75 });
    expect(out.data).toEqual(tool.image.data);
  });

  it("alpha, palette, bit depth and edge do what they say", () => {
    const soft = createImage(4, 1);
    soft.data.set([10, 20, 30, 100, 10, 20, 30, 200, 0, 0, 0, 0, 1, 2, 3, 128]);
    expect([...STEPS.alpha.run(soft, STEPS.alpha.schema.parse({ threshold: 128 }), {}).data]).toEqual([0, 0, 0, 0, 10, 20, 30, 255, 0, 0, 0, 0, 1, 2, 3, 255]);
    expect(colours(STEPS.palette.run(src, STEPS.palette.schema.parse({ colours: 6, dither: "none" }), {}))).toBeLessThanOrEqual(6);
    const builtin = STEPS.palette.run(src, STEPS.palette.schema.parse({ source: "builtin", builtin: "four-shade", dither: "none" }), {});
    expect(colours(builtin)).toBeLessThanOrEqual(4);
    const bits = STEPS.dither.run(src, STEPS.dither.schema.parse({ r: 2, g: 2, b: 2, dither: "none" }), {});
    for (let i = 0; i < bits.data.length; i += 4) expect([0, 85, 170, 255]).toContain(bits.data[i]);
    const padded = STEPS.edge.run(createImage(5, 3, [9, 9, 9, 255]), STEPS.edge.schema.parse({ padding: 2, fill: "extend", pot: true }), {});
    expect([padded.width, padded.height]).toEqual([16, 8]);
    expect(isPowerOfTwo(padded.width) && isPowerOfTwo(padded.height)).toBe(true);
    const wrapped = STEPS.edge.run(createImage(2, 2, [0, 0, 0, 255]), STEPS.edge.schema.parse({ padding: 1, fill: "colour", colour: "#ff0000" }), {});
    expect([...wrapped.data.subarray(0, 4)]).toEqual([255, 0, 0, 255]);
  });

  it("seamless needs a canvas and says so in Node", () => {
    expect(() => STEPS.seamless.run(src, STEPS.seamless.schema.parse({}), {})).toThrow(/browser canvas/);
  });
});

describe("running pipelines", () => {
  it("every built-in preset runs and is deterministic", async () => {
    const a = await input("a", renderDemoTexture("demo-rusted-plate", 160));
    const b = await input("b", renderDemoTexture("demo-wood-planks", 96));
    for (const preset of BUILTIN_PRESETS) {
      const p = preset.build();
      const one = await runPipeline(p, [a, b], { yieldBetween: false });
      const two = await runPipeline(parsePipeline(serialisePipeline(p)).pipeline, [a, b], { yieldBetween: false });
      expect(one.images.get("a")!.data).toEqual(two.images.get("a")!.data);
      if (preset.id === "atlas-128-grid") {
        expect(one.atlas!.doc.frames.map((f) => [f.name, f.w, f.h])).toEqual([
          ["a", 128, 128],
          ["b", 128, 128],
        ]);
        expect(isPowerOfTwo(one.atlas!.image.width)).toBe(true);
      } else expect(one.atlas).toBeNull();
    }
  });

  it("previews any step, skips disabled ones and reuses the unchanged prefix", async () => {
    const img = await input("a", renderDemoTexture("demo-cobblestones", 128));
    const p: Pipeline = { ...emptyPipeline(), steps: [newStep("resize", { width: 64, height: 64 }), newStep("adjust", { brightness: 30 }), newStep("dither", { r: 3, g: 3, b: 3 })] };
    const counted: string[] = [];
    const cache = new SizedLru<WorkValue>(64e6, valueBytes);
    const progress = (done: number) => counted.push(String(done));
    expect(await runTo(p, img, null, { cache })).toBe(img.image);
    const afterResize = await runTo(p, img, p.steps[0]!.id, { cache });
    expect([afterResize.width, afterResize.height]).toEqual([64, 64]);

    const final = (await runPipeline(p, [img], { cache, onProgress: progress })).images.get("a")!;
    // Changing the last step recomputes only that step.
    counted.length = 0;
    const g = buildGraph(p, [img], {});
    const edited: Pipeline = { ...p, steps: p.steps.map((s, i) => (i === 2 ? { ...s, params: { ...s.params, r: 2 } } : s)) };
    let runs = 0;
    const counting = { get: (k: string) => cache.get(k), set: (k: string, v: WorkValue) => (runs++, cache.set(k, v)) };
    await runPipeline(edited, [img], { cache: counting });
    expect(runs).toBe(1);
    expect(g.nodes.length).toBe(4);

    // Disabled steps pass the image through.
    const off: Pipeline = { ...p, steps: p.steps.map((s, i) => (i === 2 ? { ...s, enabled: false } : s)) };
    const withoutDither = (await runPipeline(off, [img], { cache })).images.get("a")!;
    expect(withoutDither.data).toEqual((await runTo(p, img, p.steps[1]!.id, { cache })).data);
    expect(withoutDither.data).not.toEqual(final.data);
  });
});

describe("export names and manifest", () => {
  it("are deterministic, keep folders and never collide", () => {
    expect(outputNames(["walls/brick.png", "walls/brick.jpg", "floor.png", "a:b?.png"], "{name}", "png")).toEqual(["walls/brick.png", "walls/brick-2.png", "floor.png", "a_b_.png"]);
    expect(outputNames(["x.png", "y.png"], "tex_{n}_{name}", "webp")).toEqual(["tex_1_x.webp", "tex_2_y.webp"]);
    expect(outputNames(Array.from({ length: 12 }, (_, i) => `i${i}.png`), "{n}", "png")[0]).toBe("01.png");
  });

  it("records the pipeline, each source and output, and failures", () => {
    const p = BUILTIN_PRESETS[1]!.build();
    const m = buildManifest(p, [
      { source: { name: "a.png", width: 10, height: 10, sha256: "a".repeat(64) }, output: { file: "a.png", width: 5, height: 5, bytes: 100, sha256: "b".repeat(64) }, error: null },
      { source: { name: "bad.png", width: 0, height: 0, sha256: "" }, output: null, error: "Unreadable image." },
    ]);
    expect(m.summary).toEqual({ inputs: 2, succeeded: 1, failed: 1 });
    expect(m.pipeline).toEqual(JSON.parse(serialisePipeline(p)));
    expect(JSON.stringify(m)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
