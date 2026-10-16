/**
 * Dev helper: converts every FBX under a folder to GLB, renders thumbnails and
 * writes a contact sheet + JSON report. Does not touch the database.
 *   tsx scripts/dev/convert-incoming.ts .data/incoming/models <out-dir>
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OverlayOptions } from "sharp";
import { convertFbxToGlb, textureBasename } from "@/lib/assets/fbx";
import { renderGlb, toRaw } from "@/lib/assets/previews";
import { gltfStats, parseGlb } from "@/lib/formats/gltf";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function main() {
  const [src = ".data/incoming/models", out = ".data/incoming/converted"] = process.argv.slice(2);
  await mkdir(out, { recursive: true });
  const files = await walk(src);
  const fbxs = files.filter((f) => f.toLowerCase().endsWith(".fbx")).sort();
  const cell = 220;
  const cols = 9;
  const composites: OverlayOptions[] = [];
  const report: unknown[] = [];
  for (const [i, fbx] of fbxs.entries()) {
    const dir = path.dirname(fbx);
    const siblings = files.filter((f) => f.startsWith(dir));
    const t0 = Date.now();
    try {
      const conv = await convertFbxToGlb(new Uint8Array(await readFile(fbx)), async (ref) => {
        const hit = siblings.find((f) => path.basename(f).toLowerCase() === textureBasename(ref));
        return hit ? new Uint8Array(await readFile(hit)) : null;
      });
      const stats = gltfStats(parseGlb(conv.glb));
      const img = await renderGlb(conv.glb, { width: cell, height: cell, background: [12, 12, 12, 255] });
      composites.push({ input: await toRaw(img).png().toBuffer(), left: (i % cols) * cell, top: Math.floor(i / cols) * cell });
      const name = path.relative(src, dir).replace(/[\\/]/g, "__");
      await writeFile(path.join(out, `${name}.glb`), conv.glb);
      report.push({ fbx: path.relative(src, fbx), glbBytes: conv.glb.byteLength, triangles: stats.sceneTriangles, size: stats.bounds?.size.map((v) => +v.toFixed(3)), textures: conv.textures, warnings: conv.warnings, ms: Date.now() - t0 });
      console.log(`ok  ${path.relative(src, dir)}  ${stats.sceneTriangles} tris  ${Date.now() - t0}ms${conv.warnings.length ? "  ! " + conv.warnings.join(" ") : ""}`);
    } catch (e) {
      report.push({ fbx: path.relative(src, fbx), error: e instanceof Error ? e.message : String(e) });
      console.log(`ERR ${path.relative(src, fbx)}: ${e instanceof Error ? e.message : e}`);
    }
  }
  await writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2));
  await sharp({ create: { width: cols * cell, height: Math.ceil(fbxs.length / cols) * cell, channels: 4, background: "#000" } })
    .composite(composites)
    .png()
    .toFile(path.join(out, "contact-sheet.png"));
  console.log(`> ${fbxs.length} models, sheet at ${path.join(out, "contact-sheet.png")}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
