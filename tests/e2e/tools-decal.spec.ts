import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { expect, test, type Page } from "@playwright/test";
import { cornerColour, DECAL_DEFAULTS, processDecal } from "../../src/lib/processing/decal";
import type { RGBAImage } from "../../src/lib/processing/image";

const decode = async (src: string | Buffer): Promise<RGBAImage> => {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
};
const status = (page: Page) => page.getByRole("region", { name: "Preview" }).getByRole("status");
const px = (img: RGBAImage, x: number, y: number) => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

async function downloadPng(page: Page, name: RegExp) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return { name: d.suggestedFilename(), img: await decode(await readFile((await d.path())!)) };
}

test.describe("decal and cutout maker", () => {
  test("green screen: background guessed, clean edges, and the PNG is exactly the core's output", async ({ page }) => {
    await page.goto("/tools/decal");
    await page.getByRole("button", { name: "+ Green screen" }).click();
    await expect(page.getByRole("list", { name: "Key colours" })).toContainText(/#[0-9a-f]{6}/i, { timeout: 20_000 });
    await expect(status(page)).toContainText("VISIBLE");
    await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();

    const { name, img } = await downloadPng(page, /^Download PNG/);
    expect(name).toBe("demo-sign-greenscreen.png");
    const src = await decode("public/demo/decals/demo-sign-greenscreen.png");
    const key = cornerColour(src)!;
    const ref = processDecal(src, { ...DECAL_DEFAULTS, key: "colour", keyColours: [key], tolerance: 12, softness: 10 });
    expect([img.width, img.height]).toEqual([ref.output.width, ref.output.height]);
    expect(Buffer.from(img.data).equals(Buffer.from(ref.output.data))).toBe(true);

    // transparent outside the subject, solid inside, no green left on the edge
    expect(px(img, 3, 3)[3]).toBe(0);
    expect(px(img, 100, 190)[3]).toBe(255); // yellow fill
    let edge = 0,
      green = 0;
    for (let i = 0; i < img.data.length; i += 4)
      if (img.data[i + 3]! > 0 && img.data[i + 3]! < 255) {
        edge++;
        green = Math.max(green, img.data[i + 1]! - Math.max(img.data[i]!, img.data[i + 2]!));
      }
    expect(edge).toBeGreaterThan(50);
    expect(green).toBeLessThan(25);
    // transparent pixels carry subject colour, not the screen's
    const corner = px(img, 3, 3);
    expect(corner[1]! - Math.max(corner[0]!, corner[2]!)).toBeLessThan(25);

    // the mask is the output's alpha
    const mask = await downloadPng(page, /^Download mask PNG/);
    for (let i = 0; i < img.data.length; i += 4) if (mask.img.data[i] !== img.data[i + 3]) throw new Error(`mask differs at ${i / 4}`);
  });

  test("brush erase and undo, pick colour, output size and power-of-two padding", async ({ page }) => {
    await page.goto("/tools/decal");
    await page.getByRole("button", { name: "+ Green screen" }).click();
    await expect(page.getByRole("list", { name: "Key colours" })).toContainText(/#/, { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();

    // erase a stroke across the middle of the sign
    await page.getByRole("button", { name: "Erase", exact: true }).click();
    const canvas = page.getByRole("img", { name: /^Decal result view/ });
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.42, box.y + box.height * 0.75);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.75, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByRole("button", { name: "Undo stroke" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();
    const erased = (await downloadPng(page, /^Download PNG/)).img;
    await page.getByRole("button", { name: "Undo stroke" }).click();
    await expect(page.getByRole("button", { name: "Undo stroke" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();
    const restored = (await downloadPng(page, /^Download PNG/)).img;
    // a band of the sign's interior was cleared, and undo brings it all back
    let cleared = 0,
      elsewhere = 0;
    for (let i = 3; i < erased.data.length; i += 4) {
      if (restored.data[i] === 255 && erased.data[i] === 0) cleared++;
      else if (restored.data[i] !== erased.data[i] && erased.data[i]! > restored.data[i]!) elsewhere++;
    }
    expect(cleared).toBeGreaterThan(300);
    expect(elsewhere).toBe(0);

    // pick: clicking the screen in the Original view adds it as a key colour
    await page.getByRole("button", { name: "Original", exact: true }).click();
    await page.getByRole("button", { name: "Pick", exact: true }).click();
    const orig = (await page.getByRole("img", { name: /^Decal original view/ }).boundingBox())!;
    await page.locator("li", { hasText: /^#/ }).first().getByRole("button").click(); // remove the guessed colour
    await expect(page.getByRole("list", { name: "Key colours" })).toContainText("No colour yet");
    await page.mouse.click(orig.x + orig.width / 2, orig.y + 24);
    await expect(page.getByRole("list", { name: "Key colours" }).getByRole("listitem")).toHaveCount(1);

    // 100 px long side, padded to 128×128
    await page.getByRole("button", { name: "Output", exact: true }).first().click();
    await page.getByRole("region", { name: "Cutout settings" }).getByRole("button", { name: "128", exact: true }).click();
    await page.getByRole("button", { name: "Pad to 2ⁿ" }).click();
    await expect(status(page)).toContainText("OUT 128×128 POT");
    const small = (await downloadPng(page, /^Download PNG/)).img;
    expect([small.width, small.height]).toEqual([128, 128]);
  });

  test("light paint keyed off black has no dark fringe, and transparent pixels are bled", async ({ page }) => {
    await page.goto("/tools/decal");
    await page.getByRole("button", { name: "+ Tag on black" }).click();
    await expect(status(page)).toContainText("VISIBLE", { timeout: 20_000 });
    await expect(page.getByRole("button", { name: /^Download PNG · / })).toBeEnabled();
    const { img } = await downloadPng(page, /^Download PNG/);
    const src = await decode("public/demo/decals/demo-tag-on-black.png");
    const ref = processDecal(src, { ...DECAL_DEFAULTS, key: "luma", lumaThreshold: 80, lumaSoftness: 120 });
    expect(Buffer.from(img.data).equals(Buffer.from(ref.output.data))).toBe(true);
    let darkest = 255;
    for (let i = 0; i < img.data.length; i += 4) if (img.data[i + 3]! < 255) darkest = Math.min(darkest, (img.data[i]! + img.data[i + 1]! + img.data[i + 2]!) / 3);
    expect(darkest).toBeGreaterThan(200);
  });
});
