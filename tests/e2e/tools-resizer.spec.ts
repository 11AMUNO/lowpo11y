import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { unzipSync } from "fflate";
import { expect, test } from "@playwright/test";

/** Gradient with a soft alpha ramp on the left edge. */
function raw(w: number, h: number) {
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[i] = (x * 3) % 256;
      px[i + 1] = (y * 3) % 256;
      px[i + 2] = 128;
      px[i + 3] = x < w / 4 ? Math.round((x / (w / 4)) * 255) : 255;
    }
  return sharp(px, { raw: { width: w, height: h, channels: 4 } });
}

test.describe("batch resizer", () => {
  test("resizes a folder tree and the ZIP keeps folders, formats, sizes and alpha", async ({ page }, info) => {
    const root = info.outputPath("pack");
    await mkdir(path.join(root, "walls", "brick"), { recursive: true });
    await mkdir(path.join(root, "floors"), { recursive: true });
    await writeFile(path.join(root, "walls", "brick", "red.png"), await raw(300, 100).png().toBuffer());
    await writeFile(path.join(root, "floors", "planks.jpg"), await raw(100, 300).flatten({ background: "#000" }).jpeg({ quality: 90 }).toBuffer());
    await writeFile(path.join(root, "floors", "notes.txt"), "not an image");
    await writeFile(path.join(root, "floors", "broken.png"), Buffer.from("not really a png"));

    await page.goto("/tools/resizer");
    await expect(page.getByRole("status").first()).toContainText("IDLE");
    await page.getByLabel("Image folder").setInputFiles(root);
    await expect(page.getByRole("button", { name: "Resize 2 files" })).toBeEnabled();
    const table = page.getByRole("table", { name: "Files to resize" });
    await expect(table.getByRole("row")).toHaveCount(4);
    await expect(table.getByRole("row", { name: /broken\.png/ })).toContainText("! Unreadable");
    // dimensions are read up front, so the planned output shows before resizing
    await expect(table.getByRole("row", { name: /red\.png/ })).toContainText("300×100");

    // long side 64, rounded to powers of two: 300×100 → 64×21 → 64×16
    await page.getByRole("button", { name: "64", exact: true }).click();
    await page.getByRole("button", { name: "Round to power of two" }).click();
    await page.getByRole("button", { name: "Keep", exact: true }).click();
    await expect(table.getByRole("row", { name: /red\.png/ })).toContainText("64×16 PNG");
    await expect(table.getByRole("row", { name: /planks\.jpg/ })).toContainText("16×64 JPG");

    await page.getByRole("button", { name: "Resize 2 files" }).click();
    await expect(page.getByRole("button", { name: "All resized" })).toBeDisabled({ timeout: 20_000 });
    await expect(table.getByRole("row", { name: /red\.png/ })).toContainText("Done ·");

    const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /^Download ZIP/ }).click()]);
    expect(download.suggestedFilename()).toMatch(/^lowpo11y-resized_\d{4}-\d{2}-\d{2}\.zip$/);
    const zip = unzipSync(await readFile((await download.path())!));
    expect(Object.keys(zip).sort()).toEqual(["pack/floors/planks.jpg", "pack/walls/brick/red.png"]);

    const red = await sharp(Buffer.from(zip["pack/walls/brick/red.png"]!)).raw().toBuffer({ resolveWithObject: true });
    expect([red.info.width, red.info.height, red.info.channels]).toEqual([64, 16, 4]);
    const alphas = new Set<number>();
    for (let i = 3; i < red.data.length; i += 4) alphas.add(red.data[i]!);
    expect(alphas.has(255) && [...alphas].some((a) => a < 255)).toBe(true);

    const planks = zip["pack/floors/planks.jpg"]!;
    expect([planks[0], planks[1]]).toEqual([0xff, 0xd8]); // still a JPEG
    const pm = await sharp(Buffer.from(planks)).metadata();
    expect([pm.width, pm.height]).toEqual([16, 64]);

    // Changing a setting marks files to resize again; removing a file shrinks the batch.
    await page.getByRole("button", { name: "Exact", exact: true }).click();
    await expect(page.getByRole("button", { name: "Resize 2 files" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Download ZIP/ })).toBeDisabled();
    await page.getByRole("button", { name: "Remove planks.jpg" }).click();
    await expect(page.getByRole("button", { name: "Resize 1 file" })).toBeEnabled();
    await page.getByRole("button", { name: "Pad", exact: true }).click();
    await page.getByRole("button", { name: "Resize 1 file" }).click();
    await expect(table.getByRole("row", { name: /red\.png/ })).toContainText("64×64 PNG");
    const [single] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Save red.png" }).click()]);
    expect(single.suggestedFilename()).toBe("red.png");
    const padded = await sharp(await readFile((await single.path())!)).raw().toBuffer({ resolveWithObject: true });
    expect([padded.info.width, padded.info.height]).toEqual([64, 64]);
    expect(padded.data[3]).toBe(0); // transparent margin above the 64×21 image
  });
});
