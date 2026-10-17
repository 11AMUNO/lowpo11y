/**
 * Turns a pipeline and its input images into graph nodes and runs them.
 * Per image: source → each enabled step in order. With an atlas step, one
 * more node reads every image's last result. Node identities are the step
 * type plus its settings, so the cache reuses any prefix of the pipeline
 * that hasn't changed (editing step 4 doesn't recompute steps 1–3).
 */
import { buildAtlasDoc, type AtlasDoc } from "@/lib/formats/atlas-json";
import { compose, pack } from "@/lib/processing/atlas";
import type { RGBAImage } from "@/lib/processing/image";
import { runGraph, type CancelSignal, type GraphCache, type GraphNode } from "./graph";
import { stableStringify } from "./hash";
import { atlasSchema, type Pipeline, type Step } from "./pipeline";
import { STEPS, type StepContext } from "./steps";

export interface WorkInput {
  /** Stable id for this image within the session. */
  id: string;
  /** File name (with any folder path), used for output names and atlas frames. */
  name: string;
  image: RGBAImage;
  /** Content key, e.g. from `imageKey()`. */
  key: string;
}

export interface AtlasOutput {
  image: RGBAImage;
  doc: AtlasDoc;
  /** Inputs that didn't fit (their names). */
  overflow: string[];
}

export type WorkValue = RGBAImage | AtlasOutput;
export const isAtlas = (v: WorkValue): v is AtlasOutput => "doc" in v;
export const valueBytes = (v: WorkValue) => (isAtlas(v) ? v.image.data.byteLength : v.data.byteLength);

export const sourceNode = (inputId: string) => `src:${inputId}`;
export const ATLAS_NODE = "atlas";

/** The atlas file's name inside exports (and in the atlas JSON). */
export const ATLAS_IMAGE = "atlas.png";

export function frameName(name: string): string {
  return name.replace(/\.[^./]+$/, "");
}

export function packAtlas(images: RGBAImage[], names: string[], params: unknown): AtlasOutput {
  const p = atlasSchema.parse(params);
  const r = pack(
    images.map((m) => ({ w: m.width, h: m.height })),
    { method: p.method, columns: p.columns, allowRotate: p.allowRotate, padding: p.padding, border: p.border, extrude: p.extrude, size: "auto", width: 0, height: 0, pot: p.pot, square: p.square },
  );
  // compose() turns rotated tiles itself
  const image = compose(images, r, p.extrude);
  const doc = buildAtlasDoc({
    image: ATLAS_IMAGE,
    width: r.width,
    height: r.height,
    uvOrigin: p.uvOrigin,
    uvInset: 0,
    padding: p.padding,
    extrude: p.extrude,
    frames: r.placements.map((pl) => ({ name: frameName(names[pl.index]!), x: pl.x, y: pl.y, w: pl.w, h: pl.h, rotated: pl.rotated, sourceW: images[pl.index]!.width, sourceH: images[pl.index]!.height })),
  });
  return { image, doc, overflow: r.overflow.map((i) => names[i]!) };
}

export interface BuiltGraph {
  nodes: GraphNode<WorkValue>[];
  /** Node holding an image's result after the given step (disabled steps pass their input through). */
  after: (inputId: string, stepId: string | null) => string;
  /** Node holding an image's final per-image result. */
  last: (inputId: string) => string;
  atlas: string | null;
}

export function buildGraph(p: Pipeline, inputs: WorkInput[], ctx: StepContext): BuiltGraph {
  const nodes: GraphNode<WorkValue>[] = [];
  const at = new Map<string, string>();
  const steps = p.steps.filter((s) => s.type !== "atlas");
  const atlasStep = p.steps.find((s) => s.type === "atlas" && s.enabled) ?? null;
  for (const input of inputs) {
    const src = sourceNode(input.id);
    nodes.push({ id: src, deps: [], key: input.key, run: () => input.image });
    let prev = src;
    at.set(`${input.id}|`, src);
    for (const s of steps) {
      if (s.enabled) {
        const def = STEPS[s.type as keyof typeof STEPS];
        const params = def.schema.parse(s.params);
        const id = `${input.id}/${s.id}`;
        nodes.push({
          id,
          deps: [prev],
          identity: `${s.type}:${stableStringify(params)}`,
          run: ([img]) => (def.run as (i: RGBAImage, p: unknown, c: StepContext) => RGBAImage)(img as RGBAImage, params, ctx),
        });
        prev = id;
      }
      at.set(`${input.id}|${s.id}`, prev);
    }
    at.set(`${input.id}|*`, prev);
  }
  let atlas: string | null = null;
  if (atlasStep && inputs.length) {
    const params = atlasSchema.parse(atlasStep.params);
    const names = inputs.map((i) => i.name);
    atlas = ATLAS_NODE;
    nodes.push({
      id: ATLAS_NODE,
      deps: inputs.map((i) => at.get(`${i.id}|*`)!),
      identity: `atlas:${stableStringify(params)}:${stableStringify(names)}`,
      run: (imgs) => packAtlas(imgs as RGBAImage[], names, params),
    });
  }
  return {
    nodes,
    after: (inputId, stepId) => {
      const n = at.get(`${inputId}|${stepId ?? ""}`) ?? at.get(`${inputId}|*`);
      if (!n) throw new Error("Unknown image or step.");
      return n;
    },
    last: (inputId) => at.get(`${inputId}|*`)!,
    atlas,
  };
}

export interface RunPipelineOptions {
  cache?: GraphCache<WorkValue>;
  signal?: CancelSignal;
  onProgress?: (done: number, total: number) => void;
  ctx?: StepContext;
  yieldBetween?: boolean;
}

/** Final per-image results (and the atlas, if the pipeline has one). */
export async function runPipeline(p: Pipeline, inputs: WorkInput[], o: RunPipelineOptions = {}): Promise<{ images: Map<string, RGBAImage>; atlas: AtlasOutput | null }> {
  const g = buildGraph(p, inputs, o.ctx ?? {});
  const targets = g.atlas ? [g.atlas] : inputs.map((i) => g.last(i.id));
  const values = await runGraph(g.nodes, [...new Set([...inputs.map((i) => g.last(i.id)), ...targets])], { cache: o.cache, signal: o.signal, onProgress: o.onProgress, yieldBetween: o.yieldBetween });
  const images = new Map(inputs.map((i) => [i.id, values.get(g.last(i.id)) as RGBAImage]));
  return { images, atlas: g.atlas ? (values.get(g.atlas) as AtlasOutput) : null };
}

/** The image after a given step (null = the original), for previews. The atlas has its own id. */
export async function runTo(p: Pipeline, input: WorkInput, stepId: string | null, o: RunPipelineOptions = {}): Promise<RGBAImage> {
  const g = buildGraph(p, [input], o.ctx ?? {});
  const target = g.after(input.id, stepId);
  const values = await runGraph(g.nodes, [target], { cache: o.cache, signal: o.signal, onProgress: o.onProgress, yieldBetween: o.yieldBetween });
  return values.get(target) as RGBAImage;
}

/** Enabled steps that change the image, in order. */
export const activeSteps = (p: Pipeline): Step[] => p.steps.filter((s) => s.enabled);
