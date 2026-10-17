import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { rgbToHex, type RGB } from "../../src/lib/processing/image";
import { extractPalette } from "../../src/lib/processing/palette";

/** Six colour blocks of different sizes with a little texture, as a PNG and as raw RGBA. */
async function reference() {
  const w = 120,
    h = 60,
    px = Buffer.alloc(w * h * 4);
  const blocks: [RGB, number][] = [
    [[176, 52, 40], 36],
    [[62, 120, 58], 26],
    [[40, 66, 150], 20],
    [[226, 196, 88], 16],
    [[30, 26, 28], 12],
    [[200, 200, 196], 10],
  ];
  for (let y = 0; y < h; y++) {
    let x0 = 0;
    for (const [c, bw] of blocks) {
      for (let x = x0; x < x0 + bw; x++) px.set([c[0] + ((x * 3 + y) % 7), c[1] + ((x + y * 5) % 5), c[2], 255], (y * w + x) * 4);
      x0 += bw;
    }
  }
  const png = await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  return { png, raw: { width: w, height: h, data: new Uint8ClampedArray(px) } };
}

const rows = (page: Page) => page.getByRole("list", { name: "Colours" }).getByRole("listitem");
const hexes = async (page: Page) => (await rows(page).allTextContents()).map((t) => /#[0-9a-f]{6}/.exec(t)![0]);

async function download(page: Page, name: string, exact = true) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name, exact }).click()]);
  return { name: d.suggestedFilename(), path: (await d.path())! };
}

test.describe("palette generator", () => {
  test("extracts deterministically, honours locks, and every format round-trips", async ({ page }) => {
    const ref = await reference();
    await page.goto("/tools/palette");
    await page.getByRole("region", { name: "Source image" }).locator("input[type=file]").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: ref.png });
    await page.getByRole("button", { name: "8", exact: true }).click();
    await page.getByRole("button", { name: "Extract 8 colours" }).click();
    await expect(rows(page)).not.toHaveCount(0);

    // the browser result equals the shared core run in Node on the same pixels
    const expected = extractPalette(ref.raw, { count: 8 }).map(rgbToHex);
    expect(await hexes(page)).toEqual(expected);

    // lock the 2nd colour, re-extract with 4: it stays first, unchanged
    const kept = expected[1]!;
    await rows(page).nth(1).getByRole("button", { name: `Lock ${kept}` }).click();
    await page.getByRole("button", { name: "4", exact: true }).click();
    await page.getByRole("button", { name: "Extract 4 colours" }).click();
    await expect(page.getByText("(1 locked kept)")).toBeVisible();
    const after = await hexes(page);
    expect(after).toHaveLength(4);
    expect(after[0]).toBe(kept);
    expect(after).toEqual(extractPalette(ref.raw, { count: 4, locked: [[parseInt(kept.slice(1, 3), 16), parseInt(kept.slice(3, 5), 16), parseInt(kept.slice(5), 16)]] }).map(rgbToHex));
    await expect(rows(page).nth(0).getByRole("button", { name: /^Lock/ })).toHaveAttribute("aria-pressed", "true");

    // name it and export every format
    await page.getByLabel("Palette name").fill("Block test");
    const files = {
      gpl: await download(page, ".GPL"),
      hex: await download(page, ".HEX"),
      json: await download(page, ".JSON"),
      png: await download(page, "Swatch PNG"),
    };
    expect(files.gpl.name).toBe("block-test.gpl");
    expect(files.png.name).toBe("block-test-8x.png");
    expect((await readFile(files.gpl.path, "utf8")).split("\n")[0]).toBe("GIMP Palette");
    const swatch = await sharp(files.png.path).metadata();
    expect([swatch.width, swatch.height]).toEqual([32, 8]);

    // importing each file gives back exactly the same colours
    for (const [kind, f] of Object.entries(files)) {
      await page.getByRole("button", { name: "Clear" }).click();
      await expect(rows(page)).toHaveCount(0);
      await page.getByLabel("Palette file").setInputFiles({ name: f.name, mimeType: kind === "png" ? "image/png" : "text/plain", buffer: await readFile(f.path) });
      await expect(page.getByText(/Imported 4 colours/).first()).toBeVisible();
      expect(await hexes(page), kind).toEqual(after);
    }
    // JSON keeps the lock and the name
    await expect(page.getByLabel("Palette name")).toHaveValue("block-test-8x"); // PNG has no name: falls back to the file name
    await page.getByRole("button", { name: "Clear" }).click();
    await page.getByLabel("Palette file").setInputFiles({ name: "p.json", mimeType: "application/json", buffer: await readFile(files.json.path) });
    await expect(page.getByLabel("Palette name")).toHaveValue("Block test");
    await expect(rows(page).nth(0).getByRole("button", { name: /^Lock/ })).toHaveAttribute("aria-pressed", "true");
  });

  test("editing, undo, harmonies, starter palettes, remembered palette and remapped image", async ({ page }) => {
    const ref = await reference();
    await page.goto("/tools/palette");
    await page.getByRole("button", { name: /^Four-shade handheld/ }).click();
    expect(await hexes(page)).toEqual(["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]);

    // edit the selected (first) colour, rename it, move it down, remove one, undo
    const inspector = page.getByRole("region", { name: "Selected colour" });
    const hex = inspector.getByLabel("Hex", { exact: true });
    await hex.fill("#123456");
    await hex.blur();
    await inspector.getByLabel("Colour name").fill("Ink");
    await expect(rows(page).nth(0)).toContainText("#123456");
    await expect(rows(page).nth(0)).toContainText("Ink");
    await inspector.getByRole("button", { name: "Move down" }).click();
    expect((await hexes(page)).slice(0, 2)).toEqual(["#306230", "#123456"]);
    await inspector.getByRole("button", { name: "Remove" }).click();
    expect(await hexes(page)).toEqual(["#306230", "#8bac0f", "#9bbc0f"]);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await hexes(page)).toEqual(["#306230", "#123456", "#8bac0f", "#9bbc0f"]);

    // harmonies add colours after the selected one
    await page.getByRole("button", { name: "Add complementary colours" }).click();
    await expect(rows(page)).toHaveCount(5);

    // colour-vision check reports on the palette
    await page.getByRole("button", { name: "Deutan" }).click();
    await expect(page.getByRole("region", { name: "Colour vision" }).getByRole("status")).toContainText(/pair|distinguishable/);
    await page.getByRole("button", { name: "Off" }).click();

    // the palette (not any image) is remembered
    const before = await hexes(page);
    await page.reload();
    await expect(rows(page)).toHaveCount(5);
    expect(await hexes(page)).toEqual(before);

    // remap an image: every pixel of the download is a palette colour
    await page.getByRole("region", { name: "Source image" }).locator("input[type=file]").setInputFiles({ name: "blocks.png", mimeType: "image/png", buffer: ref.png });
    await page.getByRole("button", { name: "F-S", exact: true }).click();
    await expect(page.getByRole("region", { name: "Preview" }).getByRole("status")).toContainText("MAPPED TO 5 COLOURS");
    await expect(page.getByRole("button", { name: /^Download image · / })).toBeEnabled();
    const img = await download(page, "Download image", false);
    expect(img.name).toBe("blocks-four-shade-handheld.png");
    const { data, info } = await sharp(img.path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([120, 60]);
    const used = new Set<string>();
    for (let i = 0; i < data.length; i += 4) used.add(rgbToHex([data[i]!, data[i + 1]!, data[i + 2]!]));
    for (const c of used) expect(before).toContain(c);
    expect(used.size).toBeGreaterThan(1);
  });
});
