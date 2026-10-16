import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";

/** Opaque test texture with a lighting gradient and a hard seam, made on the fly. */
async function texture(w: number, h: number, hue: number): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const v = ((x * 7 + y * 13) % 64) + (x < w / 2 ? 40 : 120);
      px[i] = (v + hue) % 256;
      px[i + 1] = v;
      px[i + 2] = 255 - v;
      px[i + 3] = 255;
    }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function loadFiles(page: Page, files: { name: string; buffer: Buffer }[]) {
  await page.getByLabel("Image files").setInputFiles(files.map((f) => ({ ...f, mimeType: "image/png" })));
}

const readout = (page: Page) => page.getByRole("status").filter({ hasText: /SIZE|PROCESSING|IDLE/ }).first();

test.describe("seamless tool", () => {
  test("processes locally, and the downloaded PNG matches the original engine exactly", async ({ page }) => {
    await page.goto("/tools/seamless");
    await expect(readout(page)).toContainText("IDLE");
    const input = await texture(64, 48, 30);
    await loadFiles(page, [{ name: "rust-panel.png", buffer: input }]);
    await expect(readout(page)).toContainText("SIZE 64×48", { timeout: 20_000 });
    await expect(readout(page)).toContainText(/SEAM [\d.]+× → [\d.]+×/);

    // Turn PSX on with Floyd–Steinberg dithering, 8 colours.
    await page.getByRole("button", { name: "Enable psx effects" }).click();
    await page.getByRole("button", { name: "F-S", exact: true }).click();
    await page.getByLabel("Colours").fill("8");
    await expect(readout(page)).toContainText(/COLOURS [1-8]\b/, { timeout: 10_000 });
    await expect(page.getByText("rust-panel.png").locator("..")).toContainText("PSX");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download", exact: true }).click()]);
    expect(download.suggestedFilename()).toBe("rust-panel.png");
    const exported = await sharp(await readFile((await download.path())!)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([exported.info.width, exported.info.height]).toEqual([64, 48]);

    // Reference: the owner's original engine, same input and settings, in the same browser.
    await page.addScriptTag({ content: await readFile("vendor/11am-seamless/engine.js", "utf8") });
    const reference = await page.evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const img = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
      const E = (window as unknown as { SeamlessEngine: { process: (i: ImageBitmap, s: object) => { canvas: HTMLCanvasElement } } }).SeamlessEngine;
      const r = E.process(img, { psx: true, psxDither: "fs", psxColors: 8 });
      return Array.from(r.canvas.getContext("2d")!.getImageData(0, 0, r.canvas.width, r.canvas.height).data);
    }, input.toString("base64"));
    expect(Buffer.from(reference).equals(exported.data)).toBe(true);
  });

  test("library, keys, undo, settings copy, batch rename and ZIP export", async ({ page }) => {
    await page.goto("/tools/seamless");
    await loadFiles(page, [
      { name: "a-floor.png", buffer: await texture(32, 32, 0) },
      { name: "b-wall.png", buffer: await texture(32, 32, 90) },
      { name: "c-roof.png", buffer: await texture(32, 32, 180) },
    ]);
    await expect(page.getByText("3 file(s) // 1 collection(s)")).toBeVisible();
    await expect(readout(page)).toContainText("SIZE 32×32", { timeout: 20_000 });

    // Keyboard: ↓ selects the next file, T toggles the tile check.
    await page.locator("body").press("ArrowDown");
    await expect(page.getByRole("heading", { name: /Viewport \/\/ b-wall/ })).toBeVisible();
    await page.locator("body").press("t");
    await expect(page.getByRole("button", { name: "Seam lines" })).toBeVisible();
    await page.locator("body").press("t");

    // Undo and reset are per file.
    await page.getByRole("button", { name: "Mirror", exact: true }).click();
    await expect(page.getByText("Kaleidoscope.")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByText("Offset + heal.")).toBeVisible();

    // Copy settings to the whole collection.
    await page.getByRole("button", { name: "Edge", exact: true }).click();
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: /^Collection \(3\)/ }).click();
    await expect(page.getByText(/Settings → 2 file\(s\)/)).toBeVisible();
    await expect(page.getByRole("list").getByText(/EDGE/)).toHaveCount(3);

    await page.getByText("Batch rename").click();
    await page.getByLabel("Rename pattern").fill("{collection}_{n}");
    await page.getByRole("button", { name: "Rename in scope" }).click();
    await expect(page.getByText("UNSORTED_03.png")).toBeVisible();

    // Sizes 1024 and 512 off: the ZIP holds 256/ and 128/ folders, each rendered fresh from the source.
    const sizes = page.getByRole("group", { name: "Sizes" });
    await sizes.getByRole("button", { name: "1024", exact: true }).click();
    await sizes.getByRole("button", { name: "512", exact: true }).click();
    await expect(page.getByLabel("Zip layout preview")).toContainText("256/");
    const [zip] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export ZIP // 6 files" }).click()]);
    expect(zip.suggestedFilename()).toMatch(/^lowpo11y-seamless_\d{4}-\d{2}-\d{2}\.zip$/);
    const entries = unzipSync(new Uint8Array(await readFile((await zip.path())!)));
    expect(Object.keys(entries).sort()).toEqual([
      "128/UNSORTED/UNSORTED_01.png",
      "128/UNSORTED/UNSORTED_02.png",
      "128/UNSORTED/UNSORTED_03.png",
      "256/UNSORTED/UNSORTED_01.png",
      "256/UNSORTED/UNSORTED_02.png",
      "256/UNSORTED/UNSORTED_03.png",
    ]);
    const meta = await sharp(Buffer.from(entries["256/UNSORTED/UNSORTED_01.png"]!)).metadata();
    expect([meta.width, meta.height]).toEqual([256, 256]);

    // Delete removes the active file.
    await page.locator("body").press("Delete");
    await expect(page.getByText(/^Files: 2/)).toBeVisible();
  });
});
