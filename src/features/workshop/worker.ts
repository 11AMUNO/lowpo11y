/// <reference lib="webworker" />
/**
 * Workshop worker. One long-lived instance serves previews: it keeps the
 * decoded inputs and a size-bounded cache of intermediate results, so
 * changing a step only recomputes from that step on. Batch jobs use a small
 * pool of these workers, one image per job. Cancelling works between steps.
 */
import { toAtlasJson } from "@/lib/formats/atlas-json";
import { encodePng } from "@/lib/formats/png";
import type { RGBAImage } from "@/lib/processing/image";
import { process as seamlessProcess } from "@/lib/processing/seamless/engine";
import { CancelledError, SizedLru, type CancelSignal } from "@/lib/workshop/graph";
import { imageKey, sha256Hex } from "@/lib/workshop/hash";
import type { Pipeline } from "@/lib/workshop/pipeline";
import { runPipeline, runTo, valueBytes, type WorkInput, type WorkValue } from "@/lib/workshop/run";
import type { StepContext } from "@/lib/workshop/steps";
import { decodeToRgba } from "../tools/shared/files";

declare const self: DedicatedWorkerGlobalScope;

export const MAX_INPUT_PIXELS = 8192 * 8192;

export type WorkerRequest =
  | { type: "load"; id: string; name: string; file: Blob }
  | { type: "unload"; id: string }
  | { type: "preview"; token: number; pipeline: Pipeline; inputId: string; stepId: string | null; compareStepId: string | null }
  | { type: "atlas-preview"; token: number; pipeline: Pipeline }
  | { type: "cancel"; token: number }
  | { type: "process"; token: number; pipeline: Pipeline; id: string; name: string; file: Blob; format: "png" | "webp"; quality: number }
  | { type: "atlas"; token: number; pipeline: Pipeline; inputs: { id: string; name: string; file: Blob }[]; format: "png" | "webp"; quality: number };

export interface Encoded {
  bytes: Uint8Array;
  width: number;
  height: number;
  sha256: string;
}

export type WorkerResponse =
  | { type: "loaded"; id: string; ok: true; width: number; height: number; key: string }
  | { type: "loaded"; id: string; ok: false; message: string }
  | { type: "progress"; token: number; done: number; total: number }
  | { type: "preview"; token: number; ok: true; image: RGBAImage; compare: RGBAImage; ms: number; colours: number; cacheBytes: number }
  | { type: "atlas-preview"; token: number; ok: true; image: RGBAImage; frames: number; overflow: string[]; ms: number }
  | { type: "processed"; token: number; ok: true; id: string; source: { width: number; height: number; sha256: string }; output: Encoded }
  | {
      type: "atlas-done";
      token: number;
      ok: true;
      sources: { id: string; width: number; height: number; sha256: string }[];
      tiles: { id: string; output: Encoded }[];
      atlas: Encoded;
      json: string;
      overflow: string[];
      failed: { id: string; message: string }[];
    }
  | { type: "failed"; token: number; id?: string; message: string; cancelled: boolean };

/** The Seamless engine draws with a 2D canvas; in a worker that's an OffscreenCanvas. */
const ctx: StepContext = {
  seamless(img, settings) {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const out = seamlessProcess(c, settings).canvas;
    const data = (out.getContext("2d") as OffscreenCanvasRenderingContext2D).getImageData(0, 0, out.width, out.height).data;
    return { width: out.width, height: out.height, data: new Uint8ClampedArray(data) };
  },
};

const inputs = new Map<string, WorkInput>();
const cache = new SizedLru<WorkValue>(320 * 1024 * 1024, valueBytes);
const cancelled = new Set<number>();
let latestPreview = 0;

/** Checked between steps: an explicit cancel, or (for previews) a newer preview, stops this run. */
function signalFor(token: number, isPreview = false): CancelSignal {
  return {
    get aborted() {
      return cancelled.has(token) || (isPreview && token !== latestPreview);
    },
  };
}

function countColours(img: RGBAImage): number {
  const seen = new Set<number>();
  const d = img.data;
  for (let i = 0; i < d.length && seen.size <= 65536; i += 4) if (d[i + 3]) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
  return seen.size;
}

async function decode(id: string, name: string, file: Blob): Promise<WorkInput> {
  const image = await decodeToRgba(file, MAX_INPUT_PIXELS);
  return { id, name, image, key: await imageKey(image) };
}

export async function encode(img: RGBAImage, format: "png" | "webp", quality: number): Promise<Encoded> {
  let bytes: Uint8Array;
  if (format === "png") bytes = encodePng(img);
  else {
    const c = new OffscreenCanvas(img.width, img.height);
    c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    const blob = await c.convertToBlob({ type: "image/webp", quality: quality / 100 });
    if (blob.type !== "image/webp") throw new Error("This browser can't save WebP. Choose PNG instead.");
    bytes = new Uint8Array(await blob.arrayBuffer());
  }
  return { bytes, width: img.width, height: img.height, sha256: await sha256Hex(bytes) };
}

const copy = (img: RGBAImage): RGBAImage => ({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) });
const post = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);
const fail = (token: number, e: unknown, id?: string) =>
  post({ type: "failed", token, id, cancelled: e instanceof CancelledError, message: e instanceof CancelledError ? "Cancelled." : e instanceof Error ? e.message : "Processing failed." });

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const m = ev.data;
  switch (m.type) {
    case "cancel":
      cancelled.add(m.token);
      return;
    case "unload":
      inputs.delete(m.id);
      return;
    case "load":
      try {
        const input = await decode(m.id, m.name, m.file);
        inputs.set(m.id, input);
        post({ type: "loaded", id: m.id, ok: true, width: input.image.width, height: input.image.height, key: input.key });
      } catch (e) {
        post({ type: "loaded", id: m.id, ok: false, message: e instanceof Error ? e.message : "Couldn't read this image." });
      }
      return;
    case "preview": {
      latestPreview = m.token;
      const input = inputs.get(m.inputId);
      if (!input) return fail(m.token, new Error("That image isn't loaded."));
      const t0 = performance.now();
      try {
        const opts = { cache, ctx, signal: signalFor(m.token, true), onProgress: (done: number, total: number) => post({ type: "progress", token: m.token, done, total }) };
        const image = await runTo(m.pipeline, input, m.stepId, opts);
        const compare = await runTo(m.pipeline, input, m.compareStepId, opts);
        const out = copy(image),
          cmp = copy(compare);
        post({ type: "preview", token: m.token, ok: true, image: out, compare: cmp, ms: Math.round(performance.now() - t0), colours: countColours(image), cacheBytes: cache.bytes }, [out.data.buffer, cmp.data.buffer]);
      } catch (e) {
        fail(m.token, e);
      }
      return;
    }
    case "atlas-preview": {
      latestPreview = m.token;
      const t0 = performance.now();
      try {
        const all = [...inputs.values()];
        const r = await runPipeline(m.pipeline, all, { cache, ctx, signal: signalFor(m.token, true), onProgress: (done, total) => post({ type: "progress", token: m.token, done, total }) });
        if (!r.atlas) throw new Error("This pipeline has no atlas step.");
        const out = copy(r.atlas.image);
        post({ type: "atlas-preview", token: m.token, ok: true, image: out, frames: r.atlas.doc.frames.length, overflow: r.atlas.overflow, ms: Math.round(performance.now() - t0) }, [out.data.buffer]);
      } catch (e) {
        fail(m.token, e);
      }
      return;
    }
    case "process": {
      try {
        const input = await decode(m.id, m.name, m.file);
        const signal = signalFor(m.token);
        const r = await runPipeline(m.pipeline, [input], { ctx, signal, onProgress: (done, total) => post({ type: "progress", token: m.token, done, total }) });
        const output = await encode(r.images.get(m.id)!, m.format, m.quality);
        cancelled.delete(m.token);
        post(
          { type: "processed", token: m.token, ok: true, id: m.id, source: { width: input.image.width, height: input.image.height, sha256: input.key.split(":")[2]! }, output },
          [output.bytes.buffer as ArrayBuffer],
        );
      } catch (e) {
        fail(m.token, e, m.id);
      }
      return;
    }
    case "atlas": {
      try {
        // An unreadable image is left out of the atlas and reported; the rest still pack.
        const loaded: WorkInput[] = [];
        const failed: { id: string; message: string }[] = [];
        for (const i of m.inputs) {
          try {
            loaded.push(await decode(i.id, i.name, i.file));
          } catch (e) {
            failed.push({ id: i.id, message: e instanceof Error ? e.message : "Couldn't read this image." });
          }
        }
        if (!loaded.length) throw new Error("None of the images could be read.");
        const r = await runPipeline(m.pipeline, loaded, { ctx, signal: signalFor(m.token), onProgress: (done, total) => post({ type: "progress", token: m.token, done, total }) });
        if (!r.atlas) throw new Error("This pipeline has no atlas step.");
        const tiles: { id: string; output: Encoded }[] = [];
        for (const i of loaded) tiles.push({ id: i.id, output: await encode(r.images.get(i.id)!, m.format, m.quality) });
        const atlas = await encode(r.atlas.image, "png", 100);
        post(
          {
            type: "atlas-done",
            token: m.token,
            ok: true,
            sources: loaded.map((i) => ({ id: i.id, width: i.image.width, height: i.image.height, sha256: i.key.split(":")[2]! })),
            tiles,
            atlas,
            json: toAtlasJson(r.atlas.doc),
            overflow: r.atlas.overflow,
            failed,
          },
          [atlas.bytes.buffer as ArrayBuffer, ...tiles.map((t) => t.output.bytes.buffer as ArrayBuffer)],
        );
      } catch (e) {
        fail(m.token, e);
      }
      return;
    }
  }
};
