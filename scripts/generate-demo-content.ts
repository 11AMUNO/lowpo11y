/**
 * Regenerates the committed demo content in public/demo/ from deterministic
 * generators in src/lib/demo. Output is CC0 and owned by the project.
 *
 *   pnpm demo:generate
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { greenScreenSign, tagOnBlack } from "@/lib/demo/decals";
import { DEMO_MODELS } from "@/lib/demo/models";
import { buildPixelFont } from "@/lib/demo/pixel-font";
import { buildRiggedPole } from "@/lib/demo/rigged";
import { DEMO_TEXTURES, renderDemoTexture } from "@/lib/demo/textures";
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
  // samples for the model inspector: a textured static prop and a skinned, animated one
  await mkdir(path.join(OUT, "models"), { recursive: true });
  const crate = DEMO_MODELS.find((m) => m.slug === "demo-wooden-crate")!;
  await writeFile(path.join(OUT, "models", "demo-wooden-crate.glb"), await crate.build());
  await writeFile(path.join(OUT, "models", "demo-rigged-pole.glb"), buildRiggedPole(new Uint8Array(await encodePng(renderDemoTexture("demo-uv-checker", 128)))));
  console.log("models demo-wooden-crate.glb, demo-rigged-pole.glb");
  // sample font for the bitmap font tool (drawn for LOWPO11Y, CC0)
  await mkdir(path.join(OUT, "fonts"), { recursive: true });
  await writeFile(path.join(OUT, "fonts", "lowpo11y-pixel.ttf"), buildPixelFont());
  console.log("font lowpo11y-pixel.ttf");
  // sources for the decal tool
  await mkdir(path.join(OUT, "decals"), { recursive: true });
  await writeFile(path.join(OUT, "decals", "demo-sign-greenscreen.png"), await encodePng(greenScreenSign()));
  await writeFile(path.join(OUT, "decals", "demo-tag-on-black.png"), await encodePng(tagOnBlack()));
  console.log("decals demo-sign-greenscreen.png, demo-tag-on-black.png");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
