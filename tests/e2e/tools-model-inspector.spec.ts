import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { parseGlb } from "../../src/lib/formats/gltf";

const POLE = "public/demo/models/demo-rigged-pole.glb";
const CRATE = "public/demo/models/demo-wooden-crate.glb";

const input = (page: Page) => page.locator('section[aria-label="Model file"] input[type=file]');
const stat = (page: Page, label: string) => page.getByRole("region", { name: "Statistics" }).locator("dt", { hasText: label }).locator("xpath=following-sibling::dd[1]");
const memory = (page: Page) => page.getByRole("region", { name: "GPU memory" }).getByRole("status");
const alert = (page: Page) => page.getByRole("region", { name: "Viewer" }).getByRole("alert");

async function open(page: Page, files: { name: string; buffer: Buffer }[]) {
  await input(page).setInputFiles(files.map((f) => ({ ...f, mimeType: "application/octet-stream" })));
}

/** Journey 6: a rigged GLB → animations and triangles → unload and reload without leaking GPU resources. */
test("journey 6: rigged GLB, animation playback, and repeated loads free everything", async ({ page }) => {
  const pole = await readFile(POLE),
    crate = await readFile(CRATE);
  await page.goto("/tools/model-inspector");
  await expect(memory(page)).toContainText("0 load");

  await open(page, [{ name: "demo-rigged-pole.glb", buffer: pole }]);
  await expect(stat(page, "Draw calls (measured)")).toHaveText("1");
  await expect(stat(page, "Triangles (in scene)")).toHaveText("68");
  await expect(stat(page, "Skins")).toHaveText("1");
  await expect(stat(page, "Animations")).toHaveText("2");
  await expect(page.getByRole("region", { name: "Meshes" })).toContainText("SKINNED");
  const anims = page.getByRole("region", { name: "Animations" });
  await expect(anims).toContainText("Bend");
  await expect(anims).toContainText("2.00 s");
  await expect(anims).toContainText("Twist");
  await expect(anims).toContainText("1.50 s");

  // play, pause, scrub, switch clip
  const transport = page.getByRole("group", { name: "Animation" });
  await transport.getByRole("button", { name: "Play" }).click();
  await expect(transport).not.toContainText("0.00 / 2.00 s", { timeout: 5_000 });
  await transport.getByRole("button", { name: "Pause" }).click();
  await page.getByLabel("Animation time").fill("1");
  await expect(transport).toContainText("1.00 / 2.00 s");
  await page.getByLabel("Clip", { exact: true }).selectOption({ label: "Twist (1.50 s)" });
  await expect(transport).toContainText("0.00 / 1.50 s");

  // display modes and helpers are safe to toggle on a skinned mesh
  for (const m of ["Unlit", "Wire", "Normals", "Shaded"]) await page.getByRole("button", { name: m, exact: true }).click();
  for (const t of ["Flat shading", "Axes", "Bounds"]) await page.getByRole("button", { name: t }).click();

  // screenshot and report
  const [shot] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Screenshot" }).click()]);
  expect(shot.suggestedFilename()).toBe("demo-rigged-pole.png");
  const meta = await sharp(await readFile((await shot.path())!)).metadata();
  expect(meta.width! > 100 && meta.height! > 100).toBe(true);
  const [rep] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Report JSON" }).click()]);
  const report = JSON.parse(await readFile((await rep.path())!, "utf8"));
  expect(report.stats.sceneTriangles).toBe(68);
  expect(report.stats.skins).toBe(1);
  expect(report.animations.map((a: { name: string }) => a.name)).toEqual(["Bend", "Twist"]);
  expect(report.rendered.drawCalls).toBe(1);

  // with this display (axes and bounds on), note what one loaded pole costs
  await open(page, [{ name: "demo-rigged-pole.glb", buffer: pole }]);
  await expect(stat(page, "Skins")).toHaveText("1");
  const loaded = (await memory(page).textContent())!.replace(/\/\/ \d+ loads?$/, "");

  // unload, then reload several times: the counts come back exactly
  await page.getByRole("button", { name: "Unload" }).click();
  const empty = (await memory(page).textContent())!.replace(/\/\/ \d+ loads?$/, "");
  for (let i = 0; i < 4; i++) {
    await open(page, [{ name: "demo-wooden-crate.glb", buffer: crate }]);
    await expect(page.getByRole("region", { name: "Textures" })).toContainText("128×128");
    await open(page, [{ name: "demo-rigged-pole.glb", buffer: pole }]);
    await expect(stat(page, "Skins")).toHaveText("1");
    await expect(memory(page)).toContainText(loaded.trim());
  }
  await page.getByRole("button", { name: "Unload" }).click();
  await expect(memory(page)).toContainText(empty.trim());
  await expect(memory(page)).toContainText("10 loads");
});

test("malformed, unsupported and multi-file glTF are handled safely", async ({ page }) => {
  await page.goto("/tools/model-inspector");

  await open(page, [{ name: "broken.glb", buffer: Buffer.from("glTF this is not a real model") }]);
  await expect(alert(page)).toContainText(/GLB|glTF/);
  await open(page, [{ name: "notes.txt.glb", buffer: Buffer.alloc(4) }]);
  await expect(alert(page)).toContainText("too small");

  // a file that needs Draco: refused for display, statistics still shown
  const draco = JSON.stringify({ asset: { version: "2.0" }, extensionsUsed: ["KHR_draco_mesh_compression"], extensionsRequired: ["KHR_draco_mesh_compression"], meshes: [], nodes: [] });
  await open(page, [{ name: "squashed.gltf", buffer: Buffer.from(draco) }]);
  await expect(alert(page)).toContainText("Draco-compressed geometry");
  await expect(page.getByRole("region", { name: "Checks" })).toContainText("KHR_draco_mesh_compression");

  // the crate as a .gltf with an external .bin and .png
  const { json, bin } = parseGlb(new Uint8Array(await readFile(CRATE)));
  const view = json.bufferViews[json.images[0].bufferView];
  const png = Buffer.from(bin!.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength));
  json.buffers = [{ uri: "crate.bin", byteLength: bin!.byteLength }];
  json.images = [{ uri: "textures/wood%20planks.png", name: "wood planks" }];
  const gltf = { name: "crate.gltf", buffer: Buffer.from(JSON.stringify(json)) };

  await open(page, [gltf]);
  await expect(alert(page)).toContainText("needs files you didn't select: crate.bin, textures/wood%20planks.png");

  await open(page, [gltf, { name: "crate.bin", buffer: Buffer.from(bin!) }, { name: "wood planks.png", buffer: png }]);
  await expect(alert(page)).toHaveCount(0);
  await expect(stat(page, "Draw calls (measured)")).toHaveText("2");
  await expect(page.getByRole("region", { name: "Textures" })).toContainText("128×128");
  await expect(stat(page, "Triangles (in scene)")).toHaveText(String((await import("../../src/lib/formats/gltf")).gltfStats(parseGlb(new Uint8Array(await readFile(CRATE)))).sceneTriangles));
});
