/**
 * Batch export on the main thread's side: a pool of Workshop workers (one
 * image per job, `concurrency` at a time), per-image failures that never
 * discard the successful outputs, and a reproducible ZIP: deterministic
 * names, fixed timestamps, and a manifest with every source, output and
 * SHA-256. Cancelling terminates the workers at once.
 */
import { zipSync, type Zippable } from "fflate";
import { CancelledError } from "@/lib/workshop/graph";
import { sha256Hex } from "@/lib/workshop/hash";
import { buildManifest, manifestJson, outputNames, type Manifest, type ManifestItem } from "@/lib/workshop/manifest";
import type { Pipeline } from "@/lib/workshop/pipeline";
import { ATLAS_IMAGE } from "@/lib/workshop/run";
import type { WorkerRequest, WorkerResponse } from "./worker";

export interface BatchInput {
  id: string;
  /** Name with any folder path from a dropped folder. */
  name: string;
  file: Blob;
  /** Where it came from when picked from the library, recorded in the manifest. */
  origin?: { asset: string; url: string; licence: string | null };
}

export interface BatchProgress {
  done: number;
  total: number;
  failed: number;
  running: string[];
}

export interface BatchResult {
  zip: Uint8Array;
  manifest: Manifest;
  failures: { name: string; message: string }[];
}

// Fixed so the same batch always gives the same ZIP bytes.
const ZIP_MTIME = new Date(Date.UTC(2020, 0, 1));

export function createWorker(): Worker {
  return new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
}

function once(w: Worker, token: number): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<WorkerResponse>) => {
      const r = ev.data;
      if (r.type === "progress" || !("token" in r) || r.token !== token) return;
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      resolve(r);
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      reject(new Error(e.message || "The worker stopped unexpectedly."));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
  });
}

const ext = (p: Pipeline) => (p.output.format === "webp" ? "webp" : "png");

function zipFiles(files: [string, Uint8Array][], manifest: Manifest, pipelineJson: string): Uint8Array {
  const entries: Zippable = {};
  // PNG and WebP are already compressed: store them, deflate only the text files.
  for (const [path, bytes] of files) entries[path] = [bytes, { level: 0, mtime: ZIP_MTIME }];
  entries["pipeline.json"] = [new TextEncoder().encode(pipelineJson), { level: 6, mtime: ZIP_MTIME }];
  entries["manifest.json"] = [new TextEncoder().encode(manifestJson(manifest)), { level: 6, mtime: ZIP_MTIME }];
  return zipSync(entries);
}

const originOf = (item: BatchInput): Pick<ManifestItem["source"], "origin"> => (item.origin ? { origin: item.origin } : {});

export async function runBatch(
  pipeline: Pipeline,
  items: BatchInput[],
  opts: { concurrency: number; pipelineJson: string; signal?: AbortSignal; onProgress?: (p: BatchProgress) => void },
): Promise<BatchResult> {
  const names = outputNames(
    items.map((i) => i.name),
    pipeline.output.naming,
    ext(pipeline),
  );
  const atlasStep = pipeline.steps.some((s) => s.type === "atlas" && s.enabled);
  const workers: Worker[] = [];
  const stop = () => workers.splice(0).forEach((w) => w.terminate());
  opts.signal?.addEventListener("abort", stop, { once: true });
  let token = 0;
  try {
    if (opts.signal?.aborted) throw new CancelledError();
    if (atlasStep) return await runAtlas(pipeline, items, names, opts, workers);

    const results: (ManifestItem | null)[] = items.map(() => null);
    const files: ([string, Uint8Array] | null)[] = items.map(() => null);
    let next = 0,
      done = 0,
      failed = 0;
    const running = new Set<string>();
    const report = () => opts.onProgress?.({ done, total: items.length, failed, running: [...running] });
    report();
    const lane = async () => {
      const w = createWorker();
      workers.push(w);
      while (next < items.length) {
        if (opts.signal?.aborted) throw new CancelledError();
        const i = next++;
        const item = items[i]!;
        running.add(item.name);
        report();
        const t = ++token;
        w.postMessage({ type: "process", token: t, pipeline, id: item.id, name: item.name, file: item.file, format: pipeline.output.format, quality: pipeline.output.quality } satisfies WorkerRequest);
        const r = await once(w, t);
        running.delete(item.name);
        if (r.type === "processed") {
          files[i] = [names[i]!, r.output.bytes];
          results[i] = {
            source: { name: item.name, width: r.source.width, height: r.source.height, sha256: r.source.sha256, ...originOf(item) },
            output: { file: names[i]!, width: r.output.width, height: r.output.height, bytes: r.output.bytes.byteLength, sha256: r.output.sha256 },
            error: null,
          };
        } else if (r.type === "failed") {
          if (r.cancelled) throw new CancelledError();
          failed++;
          results[i] = { source: { name: item.name, width: 0, height: 0, sha256: await sha256Hex(new Uint8Array(await item.file.arrayBuffer())), ...originOf(item) }, output: null, error: r.message };
        }
        done++;
        report();
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, items.length)) }, lane));
    const manifest = buildManifest(pipeline, results as ManifestItem[]);
    const zip = zipFiles(
      files.filter((f): f is [string, Uint8Array] => !!f),
      manifest,
      opts.pipelineJson,
    );
    return { zip, manifest, failures: (results as ManifestItem[]).filter((r) => r.error).map((r) => ({ name: r.source.name, message: r.error! })) };
  } catch (e) {
    if (opts.signal?.aborted) throw new CancelledError();
    throw e;
  } finally {
    opts.signal?.removeEventListener("abort", stop);
    stop();
  }
}

async function runAtlas(
  pipeline: Pipeline,
  items: BatchInput[],
  names: string[],
  opts: { pipelineJson: string; signal?: AbortSignal; onProgress?: (p: BatchProgress) => void },
  workers: Worker[],
): Promise<BatchResult> {
  const w = createWorker();
  workers.push(w);
  opts.onProgress?.({ done: 0, total: items.length, failed: 0, running: ["atlas"] });
  const onProgress = (ev: MessageEvent<WorkerResponse>) => {
    const r = ev.data;
    if (r.type === "progress") opts.onProgress?.({ done: Math.min(items.length, Math.floor((r.done / r.total) * items.length)), total: items.length, failed: 0, running: ["atlas"] });
  };
  w.addEventListener("message", onProgress);
  w.postMessage({ type: "atlas", token: 1, pipeline, inputs: items.map((i) => ({ id: i.id, name: i.name, file: i.file })), format: pipeline.output.format, quality: pipeline.output.quality } satisfies WorkerRequest);
  const r = await once(w, 1);
  w.removeEventListener("message", onProgress);
  if (r.type === "failed") throw r.cancelled ? new CancelledError() : new Error(r.message);
  if (r.type !== "atlas-done") throw new Error("Unexpected reply from the worker.");
  const failedBy = new Map(r.failed.map((f) => [f.id, f.message]));
  const sources = new Map(r.sources.map((s) => [s.id, s]));
  const tiles = new Map(r.tiles.map((t) => [t.id, t.output]));
  const files: [string, Uint8Array][] = [[ATLAS_IMAGE, r.atlas.bytes]];
  const jsonBytes = new TextEncoder().encode(r.json);
  files.push(["atlas.json", jsonBytes]);
  const results: ManifestItem[] = [];
  for (const [i, item] of items.entries()) {
    const src = sources.get(item.id);
    const tile = tiles.get(item.id);
    if (src && tile) {
      const path = `tiles/${names[i]!}`;
      files.push([path, tile.bytes]);
      results.push({
        source: { name: item.name, width: src.width, height: src.height, sha256: src.sha256, ...originOf(item) },
        output: { file: path, width: tile.width, height: tile.height, bytes: tile.bytes.byteLength, sha256: tile.sha256 },
        error: null,
      });
    } else {
      results.push({ source: { name: item.name, width: 0, height: 0, sha256: await sha256Hex(new Uint8Array(await item.file.arrayBuffer())), ...originOf(item) }, output: null, error: failedBy.get(item.id) ?? "Not processed." });
    }
  }
  const manifest = buildManifest(pipeline, results, {
    image: ATLAS_IMAGE,
    data: "atlas.json",
    width: r.atlas.width,
    height: r.atlas.height,
    bytes: r.atlas.bytes.byteLength,
    sha256: r.atlas.sha256,
    frames: r.tiles.length - r.overflow.length,
    overflow: r.overflow,
  });
  opts.onProgress?.({ done: items.length, total: items.length, failed: r.failed.length, running: [] });
  return { zip: zipFiles(files, manifest, opts.pipelineJson), manifest, failures: results.filter((x) => x.error).map((x) => ({ name: x.source.name, message: x.error! })) };
}
