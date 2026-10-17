/// <reference lib="webworker" />
import { encodePng } from "@/lib/formats/png";
import type { RGBAImage } from "@/lib/processing/image";
import { convertRetro, type RetroSettings } from "@/lib/processing/retro";
import { decodeToRgba } from "../shared/files";

declare const self: DedicatedWorkerGlobalScope;

export type ConverterRequest = { token: number; fileKey: string; file: Blob; settings: RetroSettings };
export type ConverterResponse =
  | {
      token: number;
      ok: true;
      inputWidth: number;
      inputHeight: number;
      base: RGBAImage;
      image: RGBAImage;
      png: Uint8Array;
      palette: [number, number, number][];
      colours: number;
      transparent: boolean;
      ms: number;
    }
  | { token: number; ok: false; message: string };

let decoded: { key: string; img: RGBAImage } | null = null;

self.onmessage = async (ev: MessageEvent<ConverterRequest>) => {
  const { token, fileKey, file, settings } = ev.data;
  try {
    if (decoded?.key !== fileKey) decoded = { key: fileKey, img: await decodeToRgba(file) };
    const t0 = performance.now();
    const r = convertRetro(decoded.img, settings);
    // The PNG is encoded from the exact buffer shown in the preview.
    const png = encodePng(r.image);
    const msg: ConverterResponse = {
      token,
      ok: true,
      inputWidth: decoded.img.width,
      inputHeight: decoded.img.height,
      base: r.base,
      image: r.image,
      png,
      palette: r.palette,
      colours: r.colours,
      transparent: r.transparent,
      ms: Math.round(performance.now() - t0),
    };
    self.postMessage(msg, [r.base.data.buffer, r.image.data.buffer, png.buffer]);
  } catch (e) {
    self.postMessage({ token, ok: false, message: e instanceof Error ? e.message : "Conversion failed." } satisfies ConverterResponse);
  }
};
