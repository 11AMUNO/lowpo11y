import type { SeamlessMetrics, SeamlessSettings } from "@/lib/processing/seamless/engine";

export type ExportFormat = "png" | "jpg" | "webp";

export interface Encoding {
  format: ExportFormat;
  /** 40..100, ignored for PNG */
  quality: number;
}

export type WorkerRequest =
  | { type: "process"; token: number; id: number; file: Blob; settings: SeamlessSettings; encode: Encoding }
  | { type: "export"; token: number; id: number; file: Blob; settings: SeamlessSettings; encode: Encoding; sample3x3?: boolean }
  | { type: "forget"; id: number };

export type WorkerResponse =
  | {
      type: "processed";
      token: number;
      id: number;
      result: ImageBitmap;
      source: ImageBitmap;
      metrics: SeamlessMetrics;
      ms: number;
      /** Encoded size of the result in the requested format. */
      bytes: number;
      inputWidth: number;
      inputHeight: number;
    }
  | { type: "exported"; token: number; blob: Blob; width: number; height: number }
  | { type: "error"; token: number; message: string };

export const MIME: Record<ExportFormat, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };
export const EXT: Record<ExportFormat, string> = { png: ".png", jpg: ".jpg", webp: ".webp" };
