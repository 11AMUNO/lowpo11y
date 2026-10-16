import sharp, { type OverlayOptions } from "sharp";
import { renderGlb, toRaw } from "@/lib/assets/previews";
import { DEMO_MODELS } from "@/lib/demo/models";
import { gltfStats, parseGlb } from "@/lib/formats/gltf";

const cell = 256;
const comps: OverlayOptions[] = [];
for (const [i, m] of DEMO_MODELS.entries()) {
  const glb = await m.build();
  const s = gltfStats(parseGlb(glb));
  console.log(m.slug, s.sceneTriangles, "tris", s.drawCalls, "draws", s.bounds?.size.map((v) => v.toFixed(2)).join("x"));
  const img = await renderGlb(glb, { width: cell, height: cell, background: [12, 12, 12, 255] });
  comps.push({ input: await toRaw(img).png().toBuffer(), left: (i % 5) * cell, top: Math.floor(i / 5) * cell });
}
await sharp({ create: { width: 5 * cell, height: 2 * cell, channels: 4, background: "#000" } }).composite(comps).png().toFile(process.argv[2]!);
