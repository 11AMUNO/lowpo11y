/// <reference lib="webworker" />
import { encodePng } from "@/lib/formats/png";
import { fitTo } from "@/lib/processing/resample";
import { fitFor, outputFormat, plannedSize, type ResizeSettings } from "@/lib/processing/resize-plan";
import { decodeToRgba } from "../shared/files";

declare const self: DedicatedWorkerGlobalScope;

export type ResizeRequest = { token: number; file: Blob; type: string; settings: ResizeSettings };
export type ResizeResponse =
  | { token: number; ok: true; blob: Blob; width: number; height: number; inputWidth: number; inputHeight: number; format: "png" | "jpg" | "webp" }
  | { token: number; ok: false; message: string };

const MIME = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" } as const;

self.onmessage = async (ev: MessageEvent<ResizeRequest>) => {
  const { token, file, type, settings } = ev.data;
  try {
    const src = await decodeToRgba(file, 8192 * 8192);
    const [w, h] = plannedSize(src.width, src.height, settings);
    const img = fitTo(src, w, h, fitFor(settings), settings.sampling);
    const format = outputFormat(settings, type);
    let blob: Blob;
    if (format === "png") {
      blob = new Blob([encodePng(img) as BlobPart], { type: MIME.png });
    } else {
      const px = new Uint8ClampedArray(img.data);
      if (format === "jpg") {
        // JPG has no alpha: composite onto black
        for (let i = 0; i < px.length; i += 4) {
          const a = px[i + 3]! / 255;
          px[i] = px[i]! * a;
          px[i + 1] = px[i + 1]! * a;
          px[i + 2] = px[i + 2]! * a;
          px[i + 3] = 255;
        }
      }
      const c = new OffscreenCanvas(w, h);
      c.getContext("2d")!.putImageData(new ImageData(px, w, h), 0, 0);
      blob = await c.convertToBlob({ type: MIME[format], quality: settings.quality / 100 });
    }
    self.postMessage({ token, ok: true, blob, width: w, height: h, inputWidth: src.width, inputHeight: src.height, format } satisfies ResizeResponse);
  } catch (e) {
    self.postMessage({ token, ok: false, message: e instanceof Error ? e.message : "Resize failed." } satisfies ResizeResponse);
  }
};
