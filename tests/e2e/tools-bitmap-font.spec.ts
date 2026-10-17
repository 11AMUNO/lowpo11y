import { readFile } from "node:fs/promises";
import sharp from "sharp";
import { strFromU8, unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { parseBmfontJson, parseBmfontText, renderBmfont, type BmFont } from "../../src/lib/formats/bmfont";
import type { RGBAImage } from "../../src/lib/processing/image";

const SAMPLE = 'Hello, gy!\nA ©°· "q" ~ {}';
const status = (page: Page) => page.getByRole("region", { name: "Preview" }).getByRole("status");

const decode = async (b: Uint8Array): Promise<RGBAImage> => {
  const { data, info } = await sharp(Buffer.from(b)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
};

async function download(page: Page, name: RegExp | string) {
  const [d] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name }).click()]);
  return { name: d.suggestedFilename(), bytes: new Uint8Array(await readFile((await d.path())!)) };
}

async function exported(page: Page) {
  const zip = unzipSync((await download(page, /^Download ZIP/)).bytes);
  const fnt = parseBmfontText(strFromU8(zip["lowpo11y-pixel.fnt"]!));
  const json = parseBmfontJson(strFromU8(zip["lowpo11y-pixel.json"]!));
  const pages = await Promise.all(fnt.pages.map((p) => decode(zip[p]!)));
  return { zip, fnt, json, pages };
}

/** Journey 7: generate a bitmap font → export → render sample text from the exported files. */
test("journey 7: bitmap font export renders exactly like the preview, with matching metrics", async ({ page }) => {
  await page.goto("/tools/bitmap-font");
  await page.getByRole("button", { name: "+ Sample font" }).click();
  await page.getByLabel("Extra characters").fill("©°·é");
  await expect(status(page)).toContainText("98 GLYPHS", { timeout: 20_000 });
  await expect(page.getByRole("region", { name: "Characters" })).toContainText("1 character isn't in this font and will be left out: é U+00E9");
  await page.getByLabel("Sample text", { exact: true }).fill(SAMPLE);
  await expect(status(page)).not.toContainText("SAMPLE CHAR");

  const { zip, fnt, json, pages } = await exported(page);
  expect(Object.keys(zip).sort()).toEqual(["lowpo11y-pixel.fnt", "lowpo11y-pixel.json", "lowpo11y-pixel_0.png"]);
  expect(json.chars).toEqual(fnt.chars);
  expect(fnt.info.face).toBe("LOWPO11Y Pixel");
  expect(fnt.common).toMatchObject({ lineHeight: 20, base: 16, pages: 1 });
  const char = (c: string) => fnt.chars.find((x) => x.id === c.codePointAt(0))!;
  // the 5×7 design at 20 px: every font pixel is 2×2
  expect(char(" ")).toMatchObject({ width: 0, height: 0, xadvance: 12 });
  expect(char("A")).toMatchObject({ width: 10, height: 14, xoffset: 0, yoffset: 2, xadvance: 12 });
  expect(char("g").yoffset + char("g").height - fnt.common.base).toBe(4); // two design pixels below the baseline
  expect(fnt.chars.some((c) => c.id === 0xe9)).toBe(false);

  // the preview is the same renderer on the same data: the exported files reproduce it exactly
  const preview = await decode((await download(page, "Preview PNG")).bytes);
  const fromFiles = renderBmfont(fnt, pages, SAMPLE).image;
  expect([fromFiles.width, fromFiles.height]).toEqual([preview.width, preview.height]);
  expect(Buffer.from(fromFiles.data).equals(Buffer.from(preview.data))).toBe(true);

  // glyph boxes and advances match the browser drawing the same font directly
  const font = (await readFile("public/demo/fonts/lowpo11y-pixel.ttf")).toString("base64");
  const measured = await page.evaluate(
    async ({ font, chars }) => {
      const face = new FontFace("journey7", Uint8Array.from(atob(font), (c) => c.charCodeAt(0)).buffer);
      await face.load();
      document.fonts.add(face);
      const cv = document.createElement("canvas");
      cv.width = 120;
      cv.height = 100;
      const x = cv.getContext("2d", { willReadFrequently: true })!;
      x.font = '20px "journey7"';
      return chars.map((ch) => {
        x.clearRect(0, 0, 120, 100);
        x.fillText(ch, 40, 60);
        const d = x.getImageData(0, 0, 120, 100).data;
        let x0 = 999,
          y0 = 999,
          x1 = -1,
          y1 = -1;
        for (let y = 0; y < 100; y++)
          for (let i = 0; i < 120; i++)
            if (d[(y * 120 + i) * 4 + 3]! >= 128) {
              x0 = Math.min(x0, i);
              y0 = Math.min(y0, y);
              x1 = Math.max(x1, i);
              y1 = Math.max(y1, y);
            }
        return { ch, x: x0 - 40, top: 60 - y0, w: x1 - x0 + 1, h: y1 - y0 + 1, advance: Math.round(x.measureText(ch).width) };
      });
    },
    { font, chars: ["A", "g", "©", "@", "~", "{", "!", "j"] },
  );
  for (const m of measured) {
    const c = char(m.ch);
    expect({ ch: m.ch, x: c.xoffset, top: fnt.common.base - c.yoffset, w: c.width, h: c.height, advance: c.xadvance }).toEqual(m);
  }
});

test("large glyphs spill onto several pages and still render from the files", async ({ page }) => {
  await page.goto("/tools/bitmap-font");
  await page.getByRole("button", { name: "+ Sample font" }).click();
  await expect(status(page)).toContainText("GLYPHS", { timeout: 20_000 });
  await page.getByLabel("Font size").fill("60");
  await page.getByLabel("Font size").press("Enter");
  await page.getByRole("button", { name: "128", exact: true }).click();
  await page.getByLabel("Sample text", { exact: true }).fill("Zap 123");
  await expect(status(page)).toContainText(/\d+ PAGES OF 128×128/);
  const { fnt, pages } = await exported(page);
  expect(pages.length).toBeGreaterThan(1);
  expect(fnt.common.pages).toBe(pages.length);
  expect(new Set(fnt.chars.map((c) => c.page)).size).toBe(pages.length);
  for (const c of fnt.chars) expect(c.x + c.width <= 128 && c.y + c.height <= 128).toBe(true);
  const preview = await decode((await download(page, "Preview PNG")).bytes);
  expect(Buffer.from(renderBmfont(fnt as BmFont, pages, "Zap 123").image.data).equals(Buffer.from(preview.data))).toBe(true);
});
