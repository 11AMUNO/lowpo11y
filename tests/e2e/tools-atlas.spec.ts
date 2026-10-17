import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { unzipSync, strFromU8 } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { parseAtlasJson, validateAtlas } from "../../src/lib/formats/atlas-json";
import { rotate, trimTransparent } from "../../src/lib/processing/atlas";
import type { RGBAImage } from "../../src/lib/processing/image";

/** Tile with unique pixels; `margin` transparent pixels around the edge. */
function tile(id: number, w: number, h: number, margin = 0): RGBAImage {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inside = x >= margin && y >= margin && x < w - margin && y < h - margin;
      data.set([(id * 50 + x * 9) % 256, (id * 90 + y * 13) % 256, (x * y) % 256, inside ? 255 : 0], (y * w + x) * 4);
    }
  return { width: w, height: h, data };
}
const png = (t: RGBAImage) => sharp(Buffer.from(t.data.buffer), { raw: { width: t.width, height: t.height, channels: 4 } }).png().toBuffer();
const decode = async (buf: Uint8Array): Promise<RGBAImage> => {
  const { data, info } = await sharp(Buffer.from(buf)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
};
const status = (page: Page) => page.getByRole("region", { name: "Atlas", exact: true }).getByRole("status");
const tileButton = (page: Page, name: string) => page.getByRole("list", { name: "Tile list" }).getByRole("button", { name: new RegExp(`^${name}\\b`) });

/** Journey 5: upload 4 tiles → atlas → export PNG + JSON → the validator confirms every UV box. */
test("journey 5: tiles → atlas → PNG + JSON whose UV boxes match the pixels", async ({ page }) => {
  const src = { crate: tile(1, 48, 32), panel: tile(2, 20, 60), decal: tile(3, 40, 40, 6), floor: tile(4, 64, 64) };
  await page.goto("/tools/texture-atlas");
  await page.getByLabel("Tile images").setInputFiles(await Promise.all(Object.entries(src).map(async ([n, t]) => ({ name: `${n}.png`, mimeType: "image/png", buffer: await png(t) }))));
  await expect(status(page)).toContainText("4 TILES", { timeout: 20_000 });

  // per-tile edits: rename crate, turn panel 90°, trim the decal's transparent margin
  await tileButton(page, "crate").click();
  await page.getByLabel("Tile name").fill("crate_side");
  await tileButton(page, "panel").click();
  await page.getByRole("button", { name: "90°", exact: true }).click();
  await tileButton(page, "decal").click();
  await page.getByRole("button", { name: "Trim transparent edges" }).click();
  await expect(tileButton(page, "decal")).toContainText("28×28");

  // tight packing with rotation, 2 px padding, 2 px extrusion, Godot UVs at texel centres
  await page.getByRole("button", { name: "Allow rotation" }).click();
  await page.getByLabel("Extrude").fill("2");
  await page.getByLabel("Extrude").press("Enter");
  await page.getByRole("button", { name: "Godot", exact: true }).click();
  await page.getByRole("button", { name: "Texel centres" }).click();
  await page.getByLabel("Atlas file name").fill("props");
  await expect(status(page)).toContainText(/PNG \d/);

  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download ZIP/ }).click()]);
  expect(dl.suggestedFilename()).toBe("props.zip");
  const zip = unzipSync(await readFile((await dl.path())!));
  expect(Object.keys(zip).sort()).toEqual(["props.csv", "props.json", "props.png"]);
  const doc = parseAtlasJson(strFromU8(zip["props.json"]!));
  const atlas = await decode(zip["props.png"]!);
  expect(doc.image).toBe("props.png");
  expect(doc.uvOrigin).toBe("top-left");
  expect(doc.uvInset).toBe(0.5);
  expect(doc.extrude).toBe(2);
  expect(doc.frames.map((f) => f.name).sort()).toEqual(["crate_side", "decal", "floor", "panel"]);

  // the same edits, applied in Node, give the tiles the atlas must contain
  const expected = new Map<string, RGBAImage>([
    ["crate_side", src.crate],
    ["panel", rotate(src.panel, 90)],
    ["decal", trimTransparent(src.decal)],
    ["floor", src.floor],
  ]);
  expect(validateAtlas(doc, atlas, expected)).toEqual([]);
  // power-of-two by default, CSV lists every frame
  expect([atlas.width, atlas.height].every((n) => (n & (n - 1)) === 0)).toBe(true);
  expect(strFromU8(zip["props.csv"]!).trim().split("\n")).toHaveLength(5);

  // a manual size that's too small is reported, and export is blocked
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await page.getByLabel("Width", { exact: true }).fill("64");
  await page.getByLabel("Width", { exact: true }).press("Enter");
  await page.getByLabel("Height", { exact: true }).fill("64");
  await page.getByLabel("Height", { exact: true }).press("Enter");
  await expect(page.getByText(/don't fit in 64×64/)).toBeVisible();
  await expect(page.getByRole("button", { name: /^Download ZIP/ })).toBeDisabled();

  // duplicate names block export too
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await tileButton(page, "floor").click();
  await page.getByLabel("Tile name").fill("decal");
  await expect(page.getByText("Give every tile a unique, non-empty name")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Download ZIP/ })).toBeDisabled();
});
