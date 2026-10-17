import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { expect, test, type Download, type Page } from "@playwright/test";
import { imageKey } from "@/lib/workshop/hash";
import { parsePipeline } from "@/lib/workshop/pipeline";
import { runPipeline } from "@/lib/workshop/run";

/** An opaque test image (opaque, so browser decoding is exact) made on the fly. */
async function png(w: number, h: number, seed: number): Promise<Buffer> {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 7 + seed * 40) & 255;
      px[i + 1] = (y * 5 + seed * 17) & 255;
      px[i + 2] = ((x ^ y) * 3 + seed) & 255;
      px[i + 3] = 255;
    }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function rgba(buf: Buffer | Uint8Array) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) };
}

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const bytesOf = async (d: Download) => new Uint8Array(await readFile((await d.path())!));

async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

const steps = (page: Page) => page.getByRole("list", { name: "Steps" });
const readout = (page: Page) => page.getByRole("status").filter({ hasText: /^>|^!/ }).first();

async function addStep(page: Page, label: string) {
  await page.getByLabel("Step to add").selectOption({ label });
  await page.getByRole("button", { name: "Add step" }).click();
}

async function setNumber(page: Page, label: string, value: number) {
  const f = page.getByLabel(label, { exact: true });
  await f.fill(String(value));
  await f.press("Enter");
}

/** Journey 8: build a pipeline, export and re-import it as JSON, batch-export, and check every output against the core. */
test("journey 8: pipeline → JSON round trip → batch ZIP whose outputs and manifest match the core", async ({ page }) => {
  await page.goto("/workshop");
  await page.getByRole("button", { name: "Start blank" }).click();
  await page.getByLabel("Pipeline name").fill("E2E pipeline");

  await addStep(page, "Resize");
  await setNumber(page, "Width", 32);
  await setNumber(page, "Height", 24);
  await page.getByLabel("Sampling").selectOption("nearest");
  await addStep(page, "Bit depth & dither");
  for (const ch of ["Red bits", "Green bits", "Blue bits"]) {
    await page.getByLabel(ch).focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
  }
  await page.getByLabel("Dither", { exact: true }).selectOption("none");
  await addStep(page, "Edge & padding");
  await setNumber(page, "Padding", 2);
  await page.getByLabel("Fill", { exact: true }).selectOption("extend");
  await expect(steps(page).getByText("3-3-3 bits")).toBeVisible();
  await expect(steps(page).getByText("2px extend")).toBeVisible();

  const inputs = [
    { name: "alpha.png", buffer: await png(64, 48, 1) },
    { name: "beta.png", buffer: await png(80, 40, 2) },
    { name: "gamma.png", buffer: await png(50, 50, 3) },
  ];
  await page.getByLabel("Images", { exact: true }).setInputFiles([...inputs.map((i) => ({ ...i, mimeType: "image/png" })), { name: "broken.png", mimeType: "image/png", buffer: Buffer.from("not an image") }]);
  const list = page.getByRole("list", { name: "Image list" });
  await expect(list.getByText("64×48")).toBeVisible({ timeout: 20_000 });
  await expect(list.getByText("! unreadable")).toBeVisible({ timeout: 20_000 });

  // Every stage previews: original, after resize, final.
  await steps(page).getByRole("button", { name: /^Original/ }).click();
  await expect(readout(page)).toContainText("64×48");
  await steps(page).getByRole("button", { name: /^Resize 32×24/ }).click();
  await expect(readout(page)).toContainText("32×24");
  await steps(page).getByRole("button", { name: /^Edge & padding/ }).click();
  await expect(readout(page)).toContainText("36×28");
  await expectAccessible(page);

  // Export the pipeline as JSON, start over, import it back.
  const jsonDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const jsonText = new TextDecoder().decode(await bytesOf(await jsonDl));
  const exported = parsePipeline(jsonText).pipeline;
  expect(exported.steps.map((s) => s.type)).toEqual(["resize", "dither", "edge"]);
  await page.getByRole("button", { name: "Start blank" }).click();
  await expect(steps(page).getByText("Resize")).toHaveCount(0);
  await page.getByLabel("Pipeline JSON file").setInputFiles({ name: "e2e.workshop.json", mimeType: "application/json", buffer: Buffer.from(jsonText) });
  await expect(steps(page).getByRole("button", { name: /^Bit depth & dither 3-3-3 bits/ })).toBeVisible();
  await expect(page.getByLabel("Pipeline name")).toHaveValue("E2E pipeline");

  // Batch export: three outputs, the unreadable file reported, nothing else lost.
  await page.getByLabel("File names").fill("tex_{n}_{name}");
  const zipDl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export 3 images (ZIP)" }).click();
  const zipBytes = await bytesOf(await zipDl);
  await expect(page.getByRole("list", { name: "Failed images" })).toContainText("broken.png");
  const zip = unzipSync(zipBytes);
  expect(Object.keys(zip).sort()).toEqual(["manifest.json", "pipeline.json", "tex_1_alpha.png", "tex_2_beta.png", "tex_3_gamma.png"]);
  const manifest = JSON.parse(new TextDecoder().decode(zip["manifest.json"]));
  expect(manifest.summary).toEqual({ inputs: 4, succeeded: 3, failed: 1 });
  expect(manifest.items[3]).toMatchObject({ source: { name: "broken.png" }, output: null });
  expect(JSON.stringify(manifest)).not.toMatch(/\d{4}-\d{2}-\d{2}T/);

  // Each output equals the same pipeline run by the core in Node, and the manifest's checksums hold.
  const pipeline = parsePipeline(new TextDecoder().decode(zip["pipeline.json"])).pipeline;
  for (const [i, input] of inputs.entries()) {
    const file = manifest.items[i].output.file as string;
    const outBytes = zip[file]!;
    expect(manifest.items[i].source).toMatchObject({ name: input.name, sha256: sha((await rgba(input.buffer)).data as unknown as Uint8Array) });
    expect(manifest.items[i].output).toMatchObject({ width: 36, height: 28, bytes: outBytes.byteLength, sha256: sha(outBytes) });
    const src = await rgba(input.buffer);
    const expected = (await runPipeline(pipeline, [{ id: "x", name: input.name, image: src, key: await imageKey(src) }], { yieldBetween: false })).images.get("x")!;
    const got = await rgba(outBytes);
    expect([got.width, got.height]).toEqual([expected.width, expected.height]);
    expect(Buffer.from(got.data).equals(Buffer.from(expected.data))).toBe(true);
  }

  // The same batch again gives a byte-identical ZIP.
  const again = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export 3 images (ZIP)" }).click();
  expect(sha(await bytesOf(await again))).toBe(sha(zipBytes));
});

test("presets, saved recipes and session restore; the atlas preset packs every image", async ({ page }) => {
  await page.goto("/workshop");
  await page.getByRole("button", { name: "+ Sample" }).click();
  await expect(page.getByRole("list", { name: "Image list" }).getByText("128×128")).toHaveCount(4, { timeout: 20_000 });

  await page.getByLabel("Preset or recipe").selectOption({ label: "Atlas 128 Grid" });
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await steps(page).getByRole("button", { name: /^Pack into atlas/ }).click();
  await expect(readout(page)).toContainText("4 FRAMES", { timeout: 20_000 });
  await expect(readout(page)).toContainText("512×512");

  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export atlas (ZIP)" }).click();
  const zip = unzipSync(await bytesOf(await dl));
  expect(Object.keys(zip).sort()).toEqual(["atlas.json", "atlas.png", "manifest.json", "pipeline.json", "tiles/cobblestones.png", "tiles/red-brick.png", "tiles/rusted-plate.png", "tiles/wood-planks.png"]);
  const atlas = JSON.parse(new TextDecoder().decode(zip["atlas.json"]));
  expect(atlas.frames.map((f: { name: string }) => f.name).sort()).toEqual(["cobblestones", "red-brick", "rusted-plate", "wood-planks"]);
  const manifest = JSON.parse(new TextDecoder().decode(zip["manifest.json"]));
  expect(manifest.atlas).toMatchObject({ image: "atlas.png", width: 512, height: 512, frames: 4, sha256: sha(zip["atlas.png"]!) });
  const page512 = await sharp(Buffer.from(zip["atlas.png"]!)).metadata();
  expect([page512.width, page512.height]).toEqual([512, 512]);

  // Save as a recipe; after a reload the pipeline and the recipe are both there.
  await page.getByLabel("Pipeline name").fill("My atlas recipe");
  await page.getByRole("button", { name: "Save recipe" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved “My atlas recipe”" }).first()).toBeVisible();
  await page.waitForTimeout(400); // the session is saved shortly after the last change
  await page.reload();
  await expect(page.getByLabel("Pipeline name")).toHaveValue("My atlas recipe");
  await expect(steps(page).getByRole("button", { name: /^Pack into atlas/ })).toBeVisible();
  await expect(page.getByLabel("Preset or recipe").locator("option", { hasText: "My atlas recipe" })).toHaveCount(1);
  // Images aren't kept unless asked.
  await expect(page.getByRole("list", { name: "Image list" })).toHaveCount(0);
});

test("a step can be turned off without losing its settings, and imports explain what they fixed", async ({ page }) => {
  await page.goto("/workshop");
  await page.getByRole("button", { name: "+ Sample" }).click();
  await expect(page.getByRole("list", { name: "Image list" }).getByText("128×128")).toHaveCount(4, { timeout: 20_000 });
  // The default preset ends in 5-5-5 colour; turning it off shows the image before it.
  await steps(page).getByRole("button", { name: /^Bit depth & dither 5-5-5/ }).click();
  const before = await readout(page).textContent();
  await steps(page).getByRole("button", { name: "On: Bit depth & dither" }).click();
  await expect(steps(page).getByText("// off")).toBeVisible();
  await expect(readout(page)).not.toHaveText(before!);
  await steps(page).getByRole("button", { name: "Off: Bit depth & dither" }).click();
  await expect(steps(page).getByRole("button", { name: /^Bit depth & dither 5-5-5/ })).toBeVisible();

  // Make seamless runs the Seamless engine on a canvas inside the worker.
  await addStep(page, "Make seamless");
  await expect(readout(page)).toContainText("128×128", { timeout: 20_000 });
  await expect(readout(page)).not.toContainText("!");
  await page.getByLabel("Method").selectOption("mirror");
  await expect(readout(page)).toContainText("256×256", { timeout: 20_000 });

  await page.getByLabel("Pipeline JSON file").setInputFiles({
    name: "old.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "lowpo11y-workshop", version: 1, name: "Old file", steps: [{ type: "atlas" }, { type: "resize", params: { width: 99999 } }] })),
  });
  const notes = page.getByRole("list", { name: "Import notes" });
  await expect(notes).toContainText('"width" was missing or out of range');
  await expect(notes).toContainText("The atlas step was moved to the end");
  await page.getByLabel("Pipeline JSON file").setInputFiles({ name: "new.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "lowpo11y-workshop", version: 9, steps: [] })) });
  await expect(page.getByRole("status").filter({ hasText: "newer version" }).first()).toBeVisible();
  await expectAccessible(page);
});

test("on a phone, long step descriptions never push the workspace wider than the screen", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/workshop");
  await page.getByRole("button", { name: "+ Sample" }).click();
  await page.getByLabel("Preset or recipe").selectOption({ label: "Pixelated Horror" });
  await page.getByRole("button", { name: "Load", exact: true }).click();
  await expect(steps(page).getByText(/gamma 0\.85/)).toBeAttached();
  const widths = await page.locator("main .grid").first().evaluate((grid) => [...grid.children].map((c) => ({ right: c.getBoundingClientRect().right, scroll: c.scrollWidth, width: c.clientWidth })));
  for (const w of widths) {
    expect(w.right).toBeLessThanOrEqual(390);
    expect(w.scroll).toBeLessThanOrEqual(w.width + 1);
  }
  await expect(page.getByRole("button", { name: "Add step" })).toBeInViewport();
  await expect(steps(page).getByRole("button", { name: "On: Palette" })).toBeInViewport({ ratio: 1 });
});
