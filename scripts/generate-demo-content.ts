/**
 * Regenerates the committed demo content in public/demo/ from deterministic
 * generators in src/lib/demo. Output is CC0 and owned by the project.
 *
 *   pnpm demo:generate
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DEMO_TEXTURES } from "@/lib/demo/textures";
import type { RGBAImage } from "@/lib/processing/image";

const OUT = path.resolve("public/demo");

export async function encodePng(img: RGBAImage): Promise<Buffer> {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 },
  })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

async function main() {
  await mkdir(path.join(OUT, "textures"), { recursive: true });
  for (const def of DEMO_TEXTURES) {
    const img = def.recipe(128);
    await writeFile(path.join(OUT, "textures", `${def.slug}.png`), await encodePng(img));
    console.log(`texture ${def.slug}.png`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
