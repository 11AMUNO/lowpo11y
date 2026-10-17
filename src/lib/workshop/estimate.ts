/**
 * Output sizes and memory, worked out from the settings without processing
 * anything: shown before a batch runs so a huge job can be spotted early.
 * Trimming depends on the pixels, so it's treated as "no smaller than 1×1,
 * no larger than before" and the estimate uses the larger bound.
 */
import { atlasSchema, type Pipeline } from "./pipeline";
import { resizeTarget, STEPS } from "./steps";

const nextPot = (n: number) => {
  let p = 1;
  while (p < n) p *= 2;
  return p;
};

/** Size after every enabled per-image step. */
export function predictSize(p: Pipeline, width: number, height: number): [number, number] {
  let w = width,
    h = height;
  for (const s of p.steps) {
    if (!s.enabled || s.type === "atlas") continue;
    switch (s.type) {
      case "crop": {
        const c = STEPS.crop.schema.parse(s.params);
        if (c.mode === "square") w = h = Math.min(w, h);
        else if (c.mode === "rect") {
          const x = Math.min(c.x, w - 1),
            y = Math.min(c.y, h - 1);
          w = Math.min(c.width, w - x);
          h = Math.min(c.height, h - y);
        }
        break;
      }
      case "resize":
        [w, h] = resizeTarget(w, h, STEPS.resize.schema.parse(s.params));
        break;
      case "seamless":
        if (STEPS.seamless.schema.parse(s.params).mode === "mirror") {
          w *= 2;
          h *= 2;
        }
        break;
      case "edge": {
        const e = STEPS.edge.schema.parse(s.params);
        w += e.padding * 2;
        h += e.padding * 2;
        if (e.pot) {
          w = Math.min(8192, nextPot(w));
          h = Math.min(8192, nextPot(h));
        }
        break;
      }
    }
  }
  return [w, h];
}

export interface BatchEstimate {
  /** Pixels in the largest single job's biggest intermediate image. */
  peakJobBytes: number;
  /** Rough peak memory while processing with `concurrency` jobs at once. */
  memoryBytes: number;
  /** Uncompressed size of all outputs (the ZIP is usually much smaller). */
  outputBytes: number;
  outputs: [number, number][];
  atlas: [number, number] | null;
}

export function estimateBatch(p: Pipeline, sizes: [number, number][], concurrency: number): BatchEstimate {
  const outputs = sizes.map(([w, h]) => predictSize(p, w, h));
  const stepCount = p.steps.filter((s) => s.enabled).length;
  // Each job holds its source, the current step's input and output, plus the encoder's copy.
  const job = (i: number) => Math.max(sizes[i]![0] * sizes[i]![1], outputs[i]![0] * outputs[i]![1]) * 4 * (stepCount ? 3 : 2);
  const jobs = sizes.map((_, i) => job(i)).sort((a, b) => b - a);
  const peakJobBytes = jobs[0] ?? 0;
  const outputBytes = outputs.reduce((n, [w, h]) => n + w * h * 4, 0);
  const atlasStep = p.steps.find((s) => s.type === "atlas" && s.enabled);
  let atlas: [number, number] | null = null;
  let memoryBytes = jobs.slice(0, Math.max(1, concurrency)).reduce((a, b) => a + b, 0);
  if (atlasStep) {
    const a = atlasSchema.parse(atlasStep.params);
    // Area-based lower bound for the page; packing adds padding and rounding.
    const area = outputs.reduce((n, [w, h]) => n + (w + a.padding + a.extrude * 2) * (h + a.padding + a.extrude * 2), 0);
    const side = Math.ceil(Math.sqrt(area)) + a.border * 2;
    const s = a.pot ? nextPot(side) : side;
    atlas = [s, s];
    // The atlas job keeps every result in memory at once, plus the page.
    memoryBytes = sizes.reduce((n, [w, h]) => n + w * h * 4, 0) + outputBytes + s * s * 4;
  }
  return { peakJobBytes, memoryBytes, outputBytes: outputBytes + (atlas ? atlas[0] * atlas[1] * 4 : 0), outputs, atlas };
}
