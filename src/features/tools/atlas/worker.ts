/// <reference lib="webworker" />
import { encodePng } from "@/lib/formats/png";
import { compose, flatten, pack, rotate, trimTransparent, type PackSettings, type Placement, type Rotation } from "@/lib/processing/atlas";
import type { RGB, RGBAImage } from "@/lib/processing/image";
import { fitTo, type Fit, type Sampling } from "@/lib/processing/resample";
import { decodeToRgba } from "../shared/files";

declare const self: DedicatedWorkerGlobalScope;

export interface TileJob {
  key: string;
  file: Blob;
  rotate: Rotation;
  trim: boolean;
  /** Flatten transparency onto this colour. */
  fill: RGB | null;
}

export interface TileSize {
  w: number;
  h: number;
  fit: Fit;
  sampling: Sampling;
}

export type AtlasRequest = { token: number; tiles: TileJob[]; tileSize: TileSize | null; pack: PackSettings };
/** The layout and pixels come first; the encoded PNG follows in a second message. */
export type AtlasResponse =
  | { token: number; ok: true; kind: "atlas"; width: number; height: number; image: RGBAImage; placements: Placement[]; overflow: number[]; sizes: { w: number; h: number }[]; failed: number[]; ms: number }
  | { token: number; ok: true; kind: "png"; png: Uint8Array }
  | { token: number; ok: false; message: string };

let latest = 0;

const cache = new Map<string, RGBAImage | null>();

async function decoded(job: TileJob): Promise<RGBAImage | null> {
  if (!cache.has(job.key)) {
    try {
      cache.set(job.key, await decodeToRgba(job.file, 4096 * 4096));
    } catch {
      cache.set(job.key, null);
    }
  }
  return cache.get(job.key)!;
}

self.onmessage = async (ev: MessageEvent<AtlasRequest>) => {
  const { token, tiles, tileSize, pack: settings } = ev.data;
  latest = token;
  try {
    const t0 = performance.now();
    const imgs: RGBAImage[] = [];
    const failed: number[] = [];
    const live = new Set(tiles.map((t) => t.key));
    for (const k of cache.keys()) if (!live.has(k)) cache.delete(k);
    for (let i = 0; i < tiles.length; i++) {
      const job = tiles[i]!;
      let img = await decoded(job);
      if (!img) {
        failed.push(i);
        img = { width: 1, height: 1, data: new Uint8ClampedArray(4) };
      }
      if (job.trim) img = trimTransparent(img);
      img = rotate(img, job.rotate);
      if (tileSize) img = fitTo(img, tileSize.w, tileSize.h, tileSize.fit, tileSize.sampling);
      if (job.fill) img = flatten(img, job.fill);
      imgs.push(img);
    }
    // unreadable tiles are left out of the layout
    const keep = imgs.map((_, i) => i).filter((i) => !failed.includes(i));
    const r = pack(
      keep.map((i) => ({ w: imgs[i]!.width, h: imgs[i]!.height })),
      settings,
    );
    const placements = r.placements.map((p) => ({ ...p, index: keep[p.index]! }));
    const overflow = r.overflow.map((i) => keep[i]!);
    const image = compose(imgs, { ...r, placements }, settings.extrude);
    const copy = new Uint8ClampedArray(image.data);
    const msg: AtlasResponse = { token, ok: true, kind: "atlas", width: r.width, height: r.height, image, placements, overflow, sizes: imgs.map((m) => ({ w: m.width, h: m.height })), failed, ms: Math.round(performance.now() - t0) };
    self.postMessage(msg, [image.data.buffer]);
    // a newer request may have arrived while this one ran; skip encoding if so
    await new Promise((r) => setTimeout(r, 0));
    if (latest !== token) return;
    const png = encodePng({ width: r.width, height: r.height, data: copy });
    self.postMessage({ token, ok: true, kind: "png", png } satisfies AtlasResponse, [png.buffer]);
  } catch (e) {
    self.postMessage({ token, ok: false, message: e instanceof Error ? e.message : "Packing failed." } satisfies AtlasResponse);
  }
};
