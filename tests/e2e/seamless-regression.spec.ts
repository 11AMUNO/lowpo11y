import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { expect, test } from "@playwright/test";

/**
 * The TypeScript port of the owner's Seamless engine must produce exactly the
 * same pixels and metrics as the original (vendor/11am-seamless/engine.js).
 * Both run in the same Chromium, on the same inputs, over a settings matrix
 * that touches every branch: modes × directions, falloffs, organic seams,
 * pixel-safe, flatten, resize/crop, mirror fit, PSX palettes and dithers,
 * 15-bit, and black keying with and without PSX.
 */

const MATRIX: Record<string, unknown>[] = [
  {},
  { mode: "blend", direction: "x" },
  { mode: "blend", direction: "y", falloff: "linear" },
  { mode: "blend", falloff: "sharp", width: 50, strength: 60 },
  { mode: "blend", jitter: 70, seed: 42 },
  { mode: "blend", pixelSafe: true, offsetX: 30, offsetY: 70 },
  { mode: "blend", flatten: 80, width: 10 },
  { mode: "mirror" },
  { mode: "mirror", direction: "x" },
  { mode: "mirror", mirrorFit: true },
  { mode: "mirror", mirrorFit: true, resample: "nearest" },
  { mode: "edge" },
  { mode: "edge", direction: "y", jitter: 40, seed: 7 },
  { mode: "edge", pixelSafe: true, falloff: "linear", width: 40 },
  { mode: "offset", offsetX: 25 },
  { tile: false, size: 64, resample: "nearest" },
  { size: 48, square: true },
  { size: 200, resample: "smooth" },
  { psx: true },
  { psx: true, psxColors: 4, psxDither: "bayer8" },
  { psx: true, psxColors: 64, psxDither: "fs", psxDitherAmt: 50 },
  { psx: true, psxDither: "none", psx15: true },
  { psx: true, psxLimit: false, psx15: true, psxDither: "bayer4" },
  { psx: true, psxLimit: false, psx15: true, psxDither: "fs" },
  { keyBlack: true },
  { keyBlack: true, keyConnected: false, keyTol: 20, keySoft: 30 },
  { keyBlack: true, keySoft: 0, mode: "edge" },
  { keyBlack: true, psx: true, psxColors: 8 },
  { tile: false, keyBlack: true, psx: true, psxDither: "fs", psx15: true },
];

let portBundle = "";
let original = "";

test.beforeAll(async () => {
  original = await readFile("vendor/11am-seamless/engine.js", "utf8");
  const out = await build({ entryPoints: ["src/lib/processing/seamless/engine.ts"], bundle: true, format: "iife", globalName: "SeamlessPort", write: false, target: "es2022" });
  portBundle = out.outputFiles[0]!.text;
});

test.describe("seamless engine port", () => {
  test("matches the original byte for byte on the main thread and in a worker", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/api/health");
    await page.addScriptTag({ content: original });
    await page.addScriptTag({ content: portBundle });

    const report = await page.evaluate(
      async ({ matrix, portSource }) => {
        type AnyEngine = { process: (img: CanvasImageSource, s: Record<string, unknown>) => { canvas: HTMLCanvasElement; metrics: Record<string, number> } };
        const w = window as unknown as { SeamlessEngine: AnyEngine; SeamlessPort: AnyEngine };

        // Inputs: two real demo textures (one with alpha holes) and two synthetic images that
        // exercise non-square sizes, gradients for flatten, and an object on black for keying.
        const fetchBitmap = async (url: string) => createImageBitmap(await (await fetch(url)).blob());
        const synthetic = async (W: number, H: number, kind: "gradient" | "object") => {
          const c = new OffscreenCanvas(W, H);
          const x = c.getContext("2d")!;
          const img = x.createImageData(W, H);
          let seed = 12345;
          const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
          for (let y = 0; y < H; y++)
            for (let i = 0; i < W; i++) {
              const p = (y * W + i) * 4;
              if (kind === "gradient") {
                img.data[p] = (i / W) * 200 + rnd() * 40;
                img.data[p + 1] = (y / H) * 160 + rnd() * 60;
                img.data[p + 2] = 90 + rnd() * 80;
                img.data[p + 3] = 255;
              } else {
                const inside = Math.hypot(i - W / 2, y - H / 2) < Math.min(W, H) * 0.32;
                const v = inside ? 60 + rnd() * 190 : rnd() * 9;
                img.data[p] = v;
                img.data[p + 1] = inside ? v * 0.8 : v;
                img.data[p + 2] = inside ? 255 - v : v;
                img.data[p + 3] = 255;
              }
            }
          x.putImageData(img, 0, 0);
          return createImageBitmap(c);
        };
        const inputs = {
          brick: await fetchBitmap("/demo/textures/demo-red-brick.png"),
          grate: await fetchBitmap("/demo/textures/demo-steel-grate.png"),
          gradient: await synthetic(96, 64, "gradient"),
          object: await synthetic(80, 80, "object"),
        };

        const pixels = (c: HTMLCanvasElement | OffscreenCanvas) => (c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D).getImageData(0, 0, c.width, c.height).data;
        const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
          if (a.length !== b.length) return { count: -1, first: -1 };
          let count = 0,
            first = -1;
          for (let i = 0; i < a.length; i++)
            if (a[i] !== b[i]) {
              count++;
              if (first < 0) first = i;
            }
          return { count, first };
        };

        const mismatches: string[] = [];
        let compared = 0;
        const reference = new Map<string, { data: Uint8ClampedArray; metrics: Record<string, number> }>();
        for (const [name, img] of Object.entries(inputs)) {
          matrix.forEach((settings, k) => {
            const a = w.SeamlessEngine.process(img, settings);
            const b = w.SeamlessPort.process(img, settings);
            const pa = pixels(a.canvas);
            const d = diff(pa, pixels(b.canvas));
            compared++;
            reference.set(`${name}:${k}`, { data: pa, metrics: a.metrics });
            if (d.count !== 0) mismatches.push(`main ${name} #${k} ${JSON.stringify(settings)}: ${d.count} bytes differ (first at ${d.first})`);
            if (JSON.stringify(a.metrics) !== JSON.stringify(b.metrics)) mismatches.push(`main ${name} #${k}: metrics ${JSON.stringify(a.metrics)} vs ${JSON.stringify(b.metrics)}`);
          });
        }

        // Same comparison with the port running in a worker on OffscreenCanvas.
        const workerCode = `${portSource}
          self.onmessage = (e) => {
            const { bitmaps, matrix } = e.data;
            const out = [];
            for (const [name, img] of Object.entries(bitmaps)) {
              matrix.forEach((s, k) => {
                const r = SeamlessPort.process(img, s);
                const data = r.canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, r.canvas.width, r.canvas.height).data;
                out.push({ key: name + ":" + k, data, metrics: r.metrics });
              });
            }
            self.postMessage(out);
          };`;
        const worker = new Worker(URL.createObjectURL(new Blob([workerCode], { type: "text/javascript" })));
        const copies = Object.fromEntries(await Promise.all(Object.entries(inputs).map(async ([n, b]) => [n, await createImageBitmap(b)] as const)));
        const results: { key: string; data: Uint8ClampedArray; metrics: Record<string, number> }[] = await new Promise((resolve, reject) => {
          worker.onmessage = (e) => resolve(e.data);
          worker.onerror = (e) => reject(new Error(e.message));
          worker.postMessage({ bitmaps: copies, matrix });
        });
        worker.terminate();
        for (const r of results) {
          const ref = reference.get(r.key)!;
          const d = diff(ref.data, r.data);
          compared++;
          if (d.count !== 0) mismatches.push(`worker ${r.key}: ${d.count} bytes differ (first at ${d.first})`);
          if (JSON.stringify(ref.metrics) !== JSON.stringify(r.metrics)) mismatches.push(`worker ${r.key}: metrics differ`);
        }
        return { compared, mismatches };
      },
      { matrix: MATRIX, portSource: portBundle },
    );

    expect(report.compared).toBe(MATRIX.length * 4 * 2);
    expect(report.mismatches).toEqual([]);
  });
});
