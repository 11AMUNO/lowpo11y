import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { validateBytes } from "gltf-validator";
import { formatCount } from "@/lib/format";
import { gltfStats, parseGlb } from "@/lib/formats/gltf";
import type { LibraryModel } from "@/lib/scene/library";

/**
 * Journey 9: the Scene Builder. Places the ten demo library models, edits
 * them (fields, gizmo, keyboard), deletes and undoes, saves and reopens the
 * .retro-scene.json with identical transforms, exports a GLB and reads it
 * back in Node, refuses bad files, recovers after a refresh, and opens a
 * 1,000-object stress scene.
 */

const ready = (page: Page) => expect(page.getByText("LOADING 3D VIEW…")).toHaveCount(0, { timeout: 30_000 });
const rows = (page: Page) => page.getByLabel("Scene objects").getByRole("listitem");
const stat = (page: Page, name: string) =>
  page
    .getByLabel("Scene statistics")
    .locator("div", { has: page.getByText(name, { exact: true }) })
    .locator("dd");
const bytesOf = async (d: Download) => new Uint8Array(await readFile((await d.path())!));
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function setNumber(page: Page, name: string, value: number) {
  const f = page.getByRole("spinbutton", { name, exact: true });
  await f.fill(String(value));
  await f.press("Enter");
}

async function pickRow(page: Page, name: string | RegExp, modifiers?: ("Shift" | "ControlOrMeta")[]) {
  await page.getByLabel("Scene objects").getByRole("button", { name, exact: true }).click({ modifiers });
}

async function library(page: Page): Promise<LibraryModel[]> {
  const r = await page.request.get("/api/scene/library?kind=model");
  expect(r.ok()).toBe(true);
  return ((await r.json()) as { items: LibraryModel[] }).items;
}

async function save(page: Page) {
  const dl = page.waitForEvent("download");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  return dl;
}

async function expectAccessible(page: Page) {
  const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

function trackErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe("Scene Builder", () => {
  test("places the ten library models, edits, undoes, saves, reopens and exports a GLB that loads back", async ({ page }) => {
    const errors = trackErrors(page);
    const lib = await library(page);
    expect(lib).toHaveLength(10);
    const total = lib.reduce((s, m) => s + (m.triangles ?? 0), 0);

    await page.goto("/scene-builder");
    await ready(page);
    await page.getByLabel("Scene name").fill("Journey 9");
    for (const [i, m] of lib.entries()) {
      await page.getByRole("button", { name: `Add ${m.title}`, exact: true }).click();
      await setNumber(page, "Position X", (i % 5) * 2.5);
      await setNumber(page, "Position Z", Math.floor(i / 5) * 3);
    }
    await expect(rows(page)).toHaveCount(10);
    await expect(stat(page, "Triangles")).toHaveText(formatCount(total), { timeout: 20_000 });
    await expect(page.getByLabel("Scene objects")).not.toContainText("!");

    // Edit through the inspector.
    await pickRow(page, "Wooden crate");
    await setNumber(page, "Rotation Y", 45);
    await setNumber(page, "Scale X", 2);
    await setNumber(page, "Position Y", 0.25);

    // Pick in the viewport: focus the crate, clear the selection, click the middle of the view.
    const canvas = page.getByRole("application");
    await canvas.focus();
    await page.keyboard.press("f");
    await page.keyboard.press("Escape");
    await expect(page.getByLabel("Name", { exact: true })).toHaveCount(0);
    const box = (await canvas.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Wooden crate");

    // Drag the move gizmo from the top view; one undo step puts it back.
    await page.keyboard.press("2");
    await expect(page.getByRole("button", { name: "Top", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("f");
    await page.waitForTimeout(300);
    const x0 = await page.getByRole("spinbutton", { name: "Position X" }).inputValue();
    const [cx, cy] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 12; i++) await page.mouse.move(cx + i * 20, cy);
    await page.mouse.up();
    await expect(page.getByRole("spinbutton", { name: "Position X" })).not.toHaveValue(x0);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("title", /Undo: Move Wooden crate/);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(page.getByRole("spinbutton", { name: "Position X" })).toHaveValue(x0);
    await page.keyboard.press("1");

    // Gizmo modes from the keyboard.
    await canvas.focus();
    await page.keyboard.press("e");
    await expect(page.getByRole("button", { name: "Rotate", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("r");
    await expect(page.getByRole("button", { name: "Scale", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("w");

    // Delete and undo; duplicate and undo; group and undo.
    await pickRow(page, "Traffic cone");
    const coneX = await page.getByRole("spinbutton", { name: "Position X" }).inputValue();
    await page.keyboard.press("Delete");
    await expect(rows(page)).toHaveCount(9);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(rows(page)).toHaveCount(10);
    await pickRow(page, "Traffic cone");
    await expect(page.getByRole("spinbutton", { name: "Position X" })).toHaveValue(coneX);
    await page.keyboard.press("ControlOrMeta+d");
    await expect(rows(page)).toHaveCount(11);
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Traffic cone 2");
    await page.keyboard.press("ControlOrMeta+z");
    await pickRow(page, "Rusted oil drum");
    await pickRow(page, "CRT monitor", ["ControlOrMeta"]);
    await page.keyboard.press("ControlOrMeta+g");
    await expect(page.getByLabel("Scene objects").getByRole("button", { name: "Collapse Group" })).toBeVisible();
    await page.keyboard.press("ControlOrMeta+z");
    await expect(rows(page)).toHaveCount(10);

    // Save, check the file, start again, reopen it, save again: byte-identical.
    const first = await save(page);
    expect(first.suggestedFilename()).toBe("journey-9.retro-scene.json");
    const firstBytes = await bytesOf(first);
    const scene = JSON.parse(new TextDecoder().decode(firstBytes));
    expect(scene).toMatchObject({ format: "lowpo11y-scene", version: 1, name: "Journey 9" });
    expect(scene.nodes).toHaveLength(10);
    expect(scene.assets).toHaveLength(10);
    expect(scene.assets.every((a: { source: string; fileId?: string }) => a.source === "library" && a.fileId)).toBe(true);
    const ci = lib.findIndex((m) => m.title === "Wooden crate");
    expect(scene.nodes.find((n: { name: string }) => n.name === "Wooden crate").transform).toEqual({ position: [(ci % 5) * 2.5, 0.25, Math.floor(ci / 5) * 3], rotation: [0, 45, 0], scale: [2, 1, 1] });

    await page.getByRole("button", { name: "New", exact: true }).click();
    await expect(rows(page)).toHaveCount(0);
    await page.getByLabel("Scene file").setInputFiles({ name: "journey-9.retro-scene.json", mimeType: "application/json", buffer: Buffer.from(firstBytes) });
    await expect(rows(page)).toHaveCount(10);
    await expect(stat(page, "Triangles")).toHaveText(formatCount(total), { timeout: 20_000 });
    const second = await bytesOf(await save(page));
    expect(sha(second)).toBe(sha(firstBytes));

    // Export, then read the GLB the way an engine would.
    await page.getByRole("button", { name: "Export GLB" }).click();
    const dialog = page.getByRole("dialog", { name: "Export GLB" });
    const dl = page.waitForEvent("download");
    await dialog.getByRole("button", { name: "Export", exact: true }).click();
    const glbFile = await dl;
    expect(glbFile.suggestedFilename()).toBe("journey-9.glb");
    await expect(dialog.getByRole("status")).toContainText("Exported and checked");
    const glbBytes = await bytesOf(glbFile);
    // The Khronos validator is what Blender's and Godot's importers are built against: no errors, no warnings.
    const report = await validateBytes(glbBytes);
    expect(report.issues.messages.filter((m) => m.severity < 2).map((m) => `${m.code} ${m.pointer}`)).toEqual([]);
    expect(report.issues.numErrors + report.issues.numWarnings).toBe(0);
    const glb = parseGlb(glbBytes);
    const stats = gltfStats(glb);
    expect(stats.sceneTriangles).toBe(total);
    const names = (glb.json.nodes ?? []).map((n: { name?: string }) => n.name);
    for (const m of lib) expect(names).toContain(m.title);
    expect(glb.json.extensionsUsed).toContain("KHR_lights_punctual");
    // One three.js mesh per glTF primitive instance.
    await expect(dialog).toContainText(`${stats.drawCalls} of ${stats.drawCalls} meshes`);
    expect(errors).toEqual([]);
  });

  test("refuses bad files with a reason, relinks a missing local file, and keeps working", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/scene-builder");
    await ready(page);

    await page.getByRole("tab", { name: "Local" }).click();
    await page.getByLabel("Local models or textures").setInputFiles([
      { name: "chair.fbx", mimeType: "application/octet-stream", buffer: Buffer.from("Kaydara FBX Binary  \u0000") },
      { name: "broken.glb", mimeType: "model/gltf-binary", buffer: Buffer.from("glTF, but not really") },
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") },
    ]);
    await expect(page.getByText(/FBX files can't be opened in the browser/)).toBeVisible();
    await expect(page.getByText(/isn't a readable glTF model/)).toBeVisible();
    await expect(page.getByText("Only GLB or glTF models can be added.")).toBeVisible();
    await expect(rows(page)).toHaveCount(0);

    const sceneFile = page.getByLabel("Scene file");
    await sceneFile.setInputFiles({ name: "bad.retro-scene.json", mimeType: "application/json", buffer: Buffer.from("{not json") });
    await expect(page.getByText("That file isn't valid JSON.")).toBeVisible();
    await sceneFile.setInputFiles({ name: "future.retro-scene.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "lowpo11y-scene", version: 99, nodes: [] })) });
    await expect(page.getByText(/saved by a newer Scene Builder/)).toBeVisible();

    // A scene that needs a file from someone's computer that this browser doesn't have.
    const crate = new Uint8Array(await readFile("public/demo/models/demo-wooden-crate.glb"));
    const missing = {
      format: "lowpo11y-scene",
      version: 1,
      name: "Missing file",
      assets: [{ id: "a-local", kind: "model", source: "local", name: "my-crate.glb", sha256: sha(crate), bytes: crate.byteLength }],
      nodes: [{ id: "n1", name: "My crate", parent: null, type: "model", asset: "a-local", transform: { position: [1, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
    };
    await sceneFile.setInputFiles({ name: "missing.retro-scene.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(missing)) });
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).toContainText("! failed");
    await pickRow(page, /^My crate/);
    await expect(page.getByLabel("Object and scene settings").getByRole("alert")).toContainText("Add it again under Assets → Local");
    await expect(page.getByText("! 1 missing")).toBeVisible();

    await page.getByLabel("Local models or textures").setInputFiles({ name: "my-crate.glb", mimeType: "model/gltf-binary", buffer: Buffer.from(crate) });
    await expect(page.getByText("Found my-crate.glb again")).toBeVisible();
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).first()).not.toContainText("!");
    await expect(stat(page, "Triangles")).toHaveText("60", { timeout: 20_000 });

    // Still editable.
    await page.getByRole("tab", { name: "Blockout" }).click();
    await page.getByRole("button", { name: "Add box" }).click();
    await expect(rows(page)).toHaveCount(2);
    expect(errors).toEqual([]);
  });

  test("survives a refresh through local recovery, local files included", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/scene-builder");
    await ready(page);
    await page.getByRole("tab", { name: "Local" }).click();
    await page.getByLabel("Local models or textures").setInputFiles("public/demo/models/demo-wooden-crate.glb");
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole("tab", { name: "Blockout" }).click();
    await page.getByRole("button", { name: "Add box" }).click();
    await setNumber(page, "Position X", 3);
    await setNumber(page, "Rotation Y", 30);
    await expect
      .poll(() => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem("lp-scene-autosave") ?? "{}").json ?? "{}").nodes?.find((n: { name: string }) => n.name === "Box")?.transform.rotation[1]))
      .toBe(30);

    await page.reload();
    await ready(page);
    await expect(rows(page)).toHaveCount(0);
    await page.getByRole("button", { name: "Restore it" }).click();
    await expect(rows(page)).toHaveCount(2);
    await expect(stat(page, "Triangles")).toHaveText("72", { timeout: 20_000 }); // the crate (from this browser's storage) and the box
    await expect(page.getByLabel("Scene objects")).not.toContainText("!");
    await pickRow(page, "Box");
    await expect(page.getByRole("spinbutton", { name: "Position X" })).toHaveValue("3");
    await expect(page.getByRole("spinbutton", { name: "Rotation Y" })).toHaveValue("30");
    expect(errors).toEqual([]);
  });

  test("textures blockout shapes from the library, drags shapes in, and passes an accessibility scan", async ({ page }) => {
    const errors = trackErrors(page);
    await page.goto("/scene-builder");
    await ready(page);
    await page.getByRole("tab", { name: "Blockout" }).click();
    await page.getByRole("list", { name: "Blockout shapes" }).getByRole("listitem").filter({ hasText: "Plane" }).dragTo(page.getByRole("application"));
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole("button", { name: "Add box" }).click();
    await page.getByRole("tab", { name: "Textures" }).click();
    await page.getByRole("list", { name: "Library textures" }).getByRole("button").first().click();
    await expect(page.getByRole("group", { name: "Surface" })).not.toContainText("none (");
    await expect(page.getByRole("group", { name: "Surface" }).getByRole("button", { name: "Remove" })).toBeVisible();
    await setNumber(page, "Repeat U", 2);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toHaveAttribute("title", /Texture repeat on Box/);
    await page.getByRole("button", { name: "Retro", exact: true }).click();
    await expectAccessible(page);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toContainText("Duplicate");
    await expectAccessible(page);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Export GLB" }).click();
    await expectAccessible(page);
    expect(errors).toEqual([]);
  });

  test("on a phone it explains first, then opens without sideways scrolling; on a desktop the page never scrolls", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/scene-builder");
    await expect(page.getByText(/needs a wider screen/)).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("button", { name: "Open anyway" }).click();
    await ready(page);
    await page.getByRole("list", { name: "Library models" }).getByRole("button").first().click();
    await expect(rows(page)).toHaveCount(1);
    const cols = await page.locator("main .grid").first().evaluate((g) => [...g.children].map((c) => ({ right: c.getBoundingClientRect().right, scrollW: c.scrollWidth, width: c.clientWidth })));
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    for (const c of cols) {
      expect(c.right).toBeLessThanOrEqual(390);
      expect(c.scrollW).toBeLessThanOrEqual(c.width + 1);
    }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/scene-builder");
    await ready(page);
    const [scrollH, innerH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    expect(scrollH).toBe(innerH);
  });

  test("opens a 1,000-object stress scene and stays usable", async ({ page }) => {
    test.setTimeout(180_000);
    const errors = trackErrors(page);
    const lib = await library(page);
    const assets = lib.map((m, i) => ({ id: `a${i}`, kind: "model", source: "library", name: m.filename, slug: m.slug, fileId: m.fileId, licence: m.licence }));
    const nodes: unknown[] = [];
    for (let i = 0; i < 500; i++) {
      const a = i % lib.length;
      nodes.push({ id: `m${i}`, name: `${lib[a]!.title} ${i}`, parent: null, type: "model", asset: `a${a}`, transform: { position: [(i % 25) * 3, 0, Math.floor(i / 25) * 3], rotation: [0, (i * 37) % 360, 0], scale: [1, 1, 1] } });
    }
    for (let i = 0; i < 500; i++)
      nodes.push({ id: `b${i}`, name: `Wall ${i}`, parent: null, type: "primitive", primitive: { shape: "box", width: 2, height: 3, depth: 0.2 }, transform: { position: [(i % 25) * 3 + 1.5, 1.5, Math.floor(i / 25) * 3 - 1.5], rotation: [0, 0, 0], scale: [1, 1, 1] } });
    const triangles = 50 * lib.reduce((s, m) => s + (m.triangles ?? 0), 0) + 500 * 12;

    await page.goto("/scene-builder");
    await ready(page);
    const t0 = Date.now();
    await page.getByLabel("Scene file").setInputFiles({ name: "stress.retro-scene.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ format: "lowpo11y-scene", version: 1, name: "Stress", assets, nodes })) });
    await expect(stat(page, "Objects")).toHaveText("1,000", { timeout: 60_000 });
    await expect(stat(page, "Triangles")).toHaveText(formatCount(triangles), { timeout: 60_000 });
    const loadMs = Date.now() - t0;
    await page.waitForTimeout(2500);
    const fps = Number(await stat(page, "FPS").innerText());
    const drawCalls = await stat(page, "Draw calls").innerText();
    expect(fps).toBeGreaterThan(0);

    // Select everything, delete, undo.
    const t1 = Date.now();
    await page.getByRole("application").focus();
    await page.keyboard.press("ControlOrMeta+a");
    await expect(page.getByRole("heading", { name: "// 1000 objects" })).toBeVisible({ timeout: 30_000 });
    await page.keyboard.press("Delete");
    await expect(rows(page)).toHaveCount(0, { timeout: 30_000 });
    await page.keyboard.press("ControlOrMeta+z");
    await expect(rows(page)).toHaveCount(1000, { timeout: 30_000 });
    const editMs = Date.now() - t1;
    test.info().annotations.push({ type: "stress", description: `1,000 objects, ${formatCount(triangles)} triangles: loaded in ${loadMs} ms, ${fps} fps, ${drawCalls} draw calls, select-all + delete + undo in ${editMs} ms (headless, software WebGL)` });
    console.log(test.info().annotations.at(-1)!.description);
    expect(errors).toEqual([]);
  });
});
