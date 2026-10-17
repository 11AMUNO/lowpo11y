/// <reference lib="webworker" />
import { encodePng } from "@/lib/formats/png";
import { processDecal, type DecalSettings } from "@/lib/processing/decal";
import type { RGBAImage } from "@/lib/processing/image";
import { decodeToRgba } from "../shared/files";

declare const self: DedicatedWorkerGlobalScope;

export type DecalRequest = { token: number; fileKey: string; file: Blob; settings: DecalSettings };
export type DecalResponse =
  | { token: number; ok: true; sourceWidth: number; sourceHeight: number; base: RGBAImage; work: RGBAImage; output: RGBAImage; png: Uint8Array; maskPng: Uint8Array; ms: number }
  | { token: number; ok: false; message: string };

let decoded: { key: string; img: RGBAImage } | null = null;

self.onmessage = async (ev: MessageEvent<DecalRequest>) => {
  const { token, fileKey, file, settings } = ev.data;
  try {
    if (decoded?.key !== fileKey) decoded = { key: fileKey, img: await decodeToRgba(file) };
    const t0 = performance.now();
    const r = processDecal(decoded.img, settings);
    // the PNG is encoded from exactly the output buffer that's previewed
    const png = encodePng(r.output);
    const maskPng = encodePng(r.mask);
    const msg: DecalResponse = { token, ok: true, sourceWidth: decoded.img.width, sourceHeight: decoded.img.height, base: r.base, work: r.work, output: r.output, png, maskPng, ms: Math.round(performance.now() - t0) };
    self.postMessage(msg, [r.base.data.buffer, r.work.data.buffer, r.output.data.buffer, png.buffer, maskPng.buffer]);
  } catch (e) {
    self.postMessage({ token, ok: false, message: e instanceof Error ? e.message : "Processing failed." } satisfies DecalResponse);
  }
};
