/**
 * Dev helper: tiles every PNG in a folder 2×2 (to expose seams) and writes a
 * nearest-scaled contact sheet.  tsx scripts/dev/contact-sheet.ts <dir> <out.png>
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";

async function main() {
  const [dir = "public/demo/textures", out = "contact-sheet.png"] = process.argv.slice(2);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".png")).sort();
  const cell = 520;
  const composites: OverlayOptions[] = [];
  for (const [i, f] of files.entries()) {
    const t = await sharp(path.join(dir, f)).resize(128, 128, { kernel: "nearest" }).toBuffer();
    const tiled = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 60, g: 60, b: 60, alpha: 1 } } })
      .composite([
        { input: t, left: 0, top: 0 },
        { input: t, left: 128, top: 0 },
        { input: t, left: 0, top: 128 },
        { input: t, left: 128, top: 128 },
      ])
      .png()
      .toBuffer();
    composites.push({ input: await sharp(tiled).resize(512, 512, { kernel: "nearest" }).toBuffer(), left: (i % 4) * cell, top: Math.floor(i / 4) * cell });
  }
  await sharp({ create: { width: 4 * cell, height: Math.ceil(files.length / 4) * cell, channels: 4, background: { r: 20, g: 20, b: 20, alpha: 1 } } })
    .composite(composites)
    .png()
    .toFile(out);
  console.log(`wrote ${out}`);
}

main();
