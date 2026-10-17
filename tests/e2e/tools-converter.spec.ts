import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { countColours } from "../../src/lib/processing/quantize";
import { convertRetro, RETRO_DEFAULTS, type RetroSettings } from "../../src/lib/processing/retro";

/**
 * Test texture: colour gradient with a fully transparent hole. Alpha is only
 * 0 or 255 so the browser's decode (through a premultiplied canvas) and
 * sharp's agree exactly; semi-transparent pixels come from resampling.
 */
async function texture(w: number, h: number): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const hole = x > w * 0.3 && x < w * 0.6 && y > h * 0.3 && y < h * 0.7;
      px[i] = Math.round((x / (w - 1)) * 255);
      px[i + 1] = Math.round((y / (h - 1)) * 255);
      px[i + 2] = (x * 5 + y * 3) % 256;
      px[i + 3] = hole ? 0 : 255;
    }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

const rgba = async (png: Buffer | string) => {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
};

const readout = (page: Page) => page.getByRole("region", { name: "Preview" }).getByRole("status");

async function load(page: Page, name: string, buffer: Buffer) {
  await page.getByRole("region", { name: "Input" }).locator("input[type=file]").setInputFiles({ name, mimeType: "image/png", buffer });
}

/** A pipeline module's header row (name button plus its summary). */
const moduleHead = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).locator("..");

async function setNumber(page: Page, label: string, value: number) {
  const f = page.getByLabel(label, { exact: true });
  await f.fill(String(value));
  await f.press("Enter");
}

async function downloadPng(page: Page) {
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download PNG/ }).click()]);
  return { name: download.suggestedFilename(), file: (await download.path())! };
}

test.describe("retro texture converter", () => {
  test("exact size, alpha kept, and the PNG holds exactly what the processing core produces", async ({ page }) => {
    await page.goto("/tools/texture-converter");
    await expect(readout(page)).toContainText("IDLE");
    const input = await texture(200, 150);
    await load(page, "panel.png", input);
    await expect(readout(page)).toContainText("IN 200×150 → OUT 128×128", { timeout: 20_000 });

    // 96×40, stretched, Floyd–Steinberg with 12 colours and seeded grain
    await setNumber(page, "Width", 96);
    await setNumber(page, "Height", 40);
    await page.getByRole("button", { name: "Stretch", exact: true }).click();
    await page.getByRole("button", { name: "F-S", exact: true }).click();
    await page.getByLabel("Colours", { exact: true }).fill("12");
    await page.getByRole("button", { name: "Adjust", exact: true }).click();
    await page.getByLabel("Grain", { exact: true }).fill("10");
    await setNumber(page, "Seed", 42);
    await expect(readout(page)).toContainText("OUT 96×40 (not power of two)", { timeout: 10_000 });
    await expect(readout(page)).toContainText("ALPHA");
    await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();

    const { name, file } = await downloadPng(page);
    expect(name).toBe("panel.png");
    const out = await rgba(file);
    expect([out.width, out.height]).toEqual([96, 40]);

    const settings: RetroSettings = { ...RETRO_DEFAULTS, width: 96, height: 40, fit: "stretch", dither: "fs", colours: 12, grain: 10, seed: 42 };
    const ref = convertRetro(await rgba(input), settings);
    expect(Buffer.from(out.data).equals(Buffer.from(ref.image.data))).toBe(true);

    const alphas = new Set<number>();
    for (let i = 3; i < out.data.length; i += 4) alphas.add(out.data[i]!);
    expect(alphas.has(0) && alphas.has(255)).toBe(true);
    expect([...alphas].some((a) => a > 0 && a < 255)).toBe(true); // soft resampled edge survives export
    await expect(readout(page)).toContainText(`COLOURS ${countColours(out)}`);

    // Same input and settings again: byte-identical file.
    const again = await downloadPng(page);
    expect((await readFile(again.file)).equals(await readFile(file))).toBe(true);
  });

  test("presets, palette lock, 1-bit cutout, undo and remembered settings", async ({ page }) => {
    await page.goto("/tools/texture-converter");
    await load(page, "decal.png", await texture(64, 64));
    await expect(readout(page)).toContainText("OUT 128×128", { timeout: 20_000 });

    await page.getByRole("button", { name: /Crunchy 8 colours/ }).click();
    await expect(readout(page)).toContainText(/COLOURS [1-8]\b/, { timeout: 10_000 });
    await page.getByRole("button", { name: "Lock palette" }).click();
    await expect(page.getByRole("button", { name: "Unlock" })).toBeVisible();
    const locked = await page.getByRole("list", { name: "Palette colours" }).getByRole("listitem").count();
    expect(locked).toBeLessThanOrEqual(8);

    await page.getByRole("button", { name: "Alpha", exact: true }).click();
    await page.getByRole("button", { name: "1-bit cutout" }).click();
    await expect(moduleHead(page, "Alpha")).toContainText("CUTOUT ≥ 128");
    await expect(readout(page)).toContainText("ALPHA", { timeout: 10_000 });
    await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();
    const cut = await rgba((await downloadPng(page)).file);
    const cutAlphas = new Set<number>();
    for (let i = 3; i < cut.data.length; i += 4) cutAlphas.add(cut.data[i]!);
    expect([...cutAlphas].sort((x, y) => x - y)).toEqual([0, 255]);

    // Undo the cutout, then redo it so it's the remembered state.
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(moduleHead(page, "Alpha")).toContainText("KEEP");
    await page.getByRole("button", { name: "1-bit cutout" }).click();

    // Settings (never the image) survive a reload.
    await page.reload();
    await expect(readout(page)).toContainText("IDLE");
    await expect(moduleHead(page, "Alpha")).toContainText("CUTOUT ≥ 128");
    await expect(moduleHead(page, "Colour")).toContainText(`LOCKED ${locked}`);
    await page.getByRole("button", { name: "Reset" }).click();
    await expect(moduleHead(page, "Colour")).toContainText("16 COL");

    // A damaged file gets a plain error and nothing to download.
    await load(page, "broken.png", Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]));
    await expect(readout(page)).toContainText("! This file can't be read as an image");
    await expect(page.getByRole("button", { name: /^Download PNG/ })).toBeDisabled();
  });
});

/** Journey 4: upload a texture → make it seamless → convert it → the downloaded PNG matches the preview. */
test("journey 4: texture → seamless → converter → PNG matching the preview", async ({ page }) => {
  // an opaque texture with a hard seam
  const w = 96,
    h = 96,
    px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = ((x * 7 + y * 13) % 64) + (x < w / 2 ? 40 : 140);
      px.set([v, (v * 2) % 256, 255 - v, 255], i);
    }
  const input = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();

  await page.goto("/tools/seamless");
  await page.getByLabel("Image files").setInputFiles({ name: "rough-stone.png", mimeType: "image/png", buffer: input });
  await expect(page.getByRole("status").filter({ hasText: /SIZE/ }).first()).toContainText("SIZE 96×96", { timeout: 20_000 });
  const [seamless] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
  const tiled = await readFile((await seamless.path())!);

  await page.goto("/tools/texture-converter");
  await load(page, seamless.suggestedFilename(), tiled);
  await setNumber(page, "Width", 64);
  await setNumber(page, "Height", 64);
  await expect(readout(page)).toContainText("IN 96×96 → OUT 64×64 // COLOURS", { timeout: 20_000 });
  await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();
  const { name, file } = await downloadPng(page);
  expect(name).toBe("rough-stone.png");
  const out = await rgba(file);

  // the file is exactly what the shared processing core makes from the seamless output
  const ref = convertRetro(await rgba(tiled), { ...RETRO_DEFAULTS, width: 64, height: 64 });
  expect(Buffer.from(out.data).equals(Buffer.from(ref.image.data))).toBe(true);

  // and it matches the preview: sample every texel shown on the "after" side of the split view
  const canvas = page.getByRole("region", { name: "Preview" }).locator("canvas");
  const result = await canvas.evaluate((cv: HTMLCanvasElement, png: { w: number; h: number; data: number[] }) => {
    const W = cv.width,
      H = cv.height,
      pad = 16 * (window.devicePixelRatio || 1);
    const k = Math.min((W - pad * 2) / png.w, (H - pad * 2) / png.h);
    const x0 = (W - png.w * k) / 2,
      y0 = (H - png.h * k) / 2,
      divider = x0 + png.w * k * 0.5;
    const shown = cv.getContext("2d")!.getImageData(0, 0, W, H).data;
    let checked = 0,
      mismatched = 0;
    for (let ty = 0; ty < png.h; ty++)
      for (let tx = 0; tx < png.w; tx++) {
        const cx = Math.floor(x0 + (tx + 0.5) * k),
          cy = Math.floor(y0 + (ty + 0.5) * k);
        if (cx <= divider + 2) continue;
        checked++;
        const a = (cy * W + cx) * 4,
          b = (ty * png.w + tx) * 4;
        if (shown[a] !== png.data[b] || shown[a + 1] !== png.data[b + 1] || shown[a + 2] !== png.data[b + 2]) mismatched++;
      }
    return { checked, mismatched };
  }, { w: out.width, h: out.height, data: Array.from(out.data) });
  expect(result.checked).toBeGreaterThan(1500);
  expect(result.mismatched).toBe(0);
});
