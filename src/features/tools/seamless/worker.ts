/// <reference lib="webworker" />
/**
 * Seamless processing off the main thread. Holds a small LRU of decoded
 * images (like the original app) so switching files and re-rendering stays
 * fast without keeping a whole library in memory.
 */
import { makeCanvas, process as runEngine, type Canvas, type SeamlessSettings } from "@/lib/processing/seamless/engine";
import { MIME, type Encoding, type WorkerRequest, type WorkerResponse } from "./protocol";

declare const self: DedicatedWorkerGlobalScope;

const MAX_PIXELS = 8192 * 8192;
const cache = new Map<number, ImageBitmap>();

async function decode(id: number, file: Blob): Promise<ImageBitmap> {
  const hit = cache.get(id);
  if (hit) {
    cache.delete(id);
    cache.set(id, hit);
    return hit;
  }
  const bmp = await createImageBitmap(file);
  if (bmp.width * bmp.height > MAX_PIXELS) {
    bmp.close();
    throw new Error("This image is larger than 8192×8192 pixels. Resize it first.");
  }
  cache.set(id, bmp);
  for (const [k, v] of cache) {
    if (cache.size <= 6) break;
    if (k === id) continue;
    v.close();
    cache.delete(k);
  }
  return bmp;
}

/** Same as the original toBlob: JPG has no alpha, so it is flattened on black. */
async function encode(canvas: Canvas, e: Encoding): Promise<Blob> {
  let c = canvas;
  if (e.format === "jpg") {
    c = makeCanvas(canvas.width, canvas.height);
    const x = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
    x.fillStyle = "#000";
    x.fillRect(0, 0, c.width, c.height);
    x.drawImage(canvas, 0, 0);
  }
  return (c as OffscreenCanvas).convertToBlob({ type: MIME[e.format], quality: e.quality / 100 });
}

/** 3×3 tiled preview, capped at 4096 px per side (as in the original). */
function sample3x3(t: Canvas): Canvas {
  const k = Math.min(1, 4096 / (t.width * 3), 4096 / (t.height * 3));
  const tw = Math.round(t.width * k),
    th = Math.round(t.height * k);
  const c = makeCanvas(tw * 3, th * 3);
  const x = c.getContext("2d") as OffscreenCanvasRenderingContext2D;
  x.imageSmoothingQuality = "high";
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) x.drawImage(t, i * tw, j * th, tw, th);
  return c;
}

const reply = (msg: WorkerResponse, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  if (msg.type === "forget") {
    cache.get(msg.id)?.close();
    cache.delete(msg.id);
    return;
  }
  try {
    const img = await decode(msg.id, msg.file);
    const settings: SeamlessSettings = msg.settings;
    if (msg.type === "process") {
      const t0 = performance.now();
      const r = runEngine(img, settings);
      const ms = Math.round(performance.now() - t0);
      const blob = await encode(r.canvas, msg.encode);
      const [result, source] = await Promise.all([createImageBitmap(r.canvas), createImageBitmap(r.source)]);
      reply({ type: "processed", token: msg.token, id: msg.id, result, source, metrics: r.metrics, ms, bytes: blob.size, inputWidth: img.width, inputHeight: img.height }, [result, source]);
    } else {
      const r = runEngine(img, settings);
      const out = msg.sample3x3 ? sample3x3(r.canvas) : r.canvas;
      reply({ type: "exported", token: msg.token, blob: await encode(out, msg.encode), width: out.width, height: out.height });
    }
  } catch (e) {
    reply({ type: "error", token: msg.token, message: e instanceof Error ? e.message : "Processing failed." });
  }
};
