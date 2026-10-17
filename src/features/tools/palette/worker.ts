/// <reference lib="webworker" />
import { encodePng } from "@/lib/formats/png";
import { cloneImage, type RGB, type RGBAImage } from "@/lib/processing/image";
import { extractPalette, simulateCvd, type Cvd } from "@/lib/processing/palette";
import { remapImage, type DitherMode } from "@/lib/processing/remap";
import { decodeToRgba } from "../shared/files";

declare const self: DedicatedWorkerGlobalScope;

export type PaletteJob =
  | { kind: "extract"; fileKey: string; file: Blob; count: number; locked: RGB[] }
  | { kind: "apply"; fileKey: string; file: Blob; palette: RGB[]; dither: DitherMode; strength: number; cvd: Cvd | null };
export type PaletteRequest = PaletteJob & { token: number };

export type PaletteResponse =
  | { token: number; ok: true; kind: "extract"; colours: RGB[]; ms: number }
  | { token: number; ok: true; kind: "apply"; width: number; height: number; source: RGBAImage; image: RGBAImage; png: Uint8Array; ms: number }
  | { token: number; ok: false; message: string };

let decoded: { key: string; img: RGBAImage } | null = null;

function simulate(img: RGBAImage, kind: Cvd) {
  const cache = new Map<number, RGB>();
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const k = (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!;
    let c = cache.get(k);
    if (!c) cache.set(k, (c = simulateCvd([d[i]!, d[i + 1]!, d[i + 2]!], kind)));
    d[i] = c[0];
    d[i + 1] = c[1];
    d[i + 2] = c[2];
  }
}

self.onmessage = async (ev: MessageEvent<PaletteRequest>) => {
  const m = ev.data;
  try {
    if (decoded?.key !== m.fileKey) decoded = { key: m.fileKey, img: await decodeToRgba(m.file) };
    const t0 = performance.now();
    if (m.kind === "extract") {
      const colours = extractPalette(decoded.img, { count: m.count, locked: m.locked });
      self.postMessage({ token: m.token, ok: true, kind: "extract", colours, ms: Math.round(performance.now() - t0) } satisfies PaletteResponse);
      return;
    }
    const source = cloneImage(decoded.img);
    const image = cloneImage(decoded.img);
    if (m.palette.length) remapImage(image, { palette: m.palette, dither: m.dither, strength: m.strength, wrap: true });
    // the PNG is the remapped image; the colour-vision view only changes the preview
    const png = encodePng(image);
    if (m.cvd) {
      simulate(image, m.cvd);
      simulate(source, m.cvd);
    }
    const res: PaletteResponse = { token: m.token, ok: true, kind: "apply", width: image.width, height: image.height, source, image, png, ms: Math.round(performance.now() - t0) };
    self.postMessage(res, [source.data.buffer, image.data.buffer, png.buffer]);
  } catch (e) {
    self.postMessage({ token: m.token, ok: false, message: e instanceof Error ? e.message : "Processing failed." } satisfies PaletteResponse);
  }
};
