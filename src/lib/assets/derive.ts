/**
 * Generates derived files for an asset: GLB from FBX, thumbnails for models
 * and textures, and power-of-two texture variants. Every generated file is
 * marked with metadata.generated so it can be replaced on regeneration and is
 * clearly labelled in the catalogue.
 */
import type { Tx } from "@/lib/db";
import type { AssetStorage } from "@/lib/storage";
import { convertFbxToGlb, textureBasename } from "./fbx";
import { storeAssetFile, type AssetFileRow } from "./files";
import { imageThumbnail, modelThumbnail, textureVariants } from "./previews";
import { getAssetById, listAssetFiles, recomputeAssetFacets, softDeleteFile } from "./repository";

export interface DeriveOptions {
  /** Replace previously generated files. */
  force?: boolean;
  /** Generate 32/64/128/256 PNG variants (below the source size) for textures. */
  textureVariants?: boolean;
}

export interface DeriveResult {
  created: { purpose: string; filename: string; generated: string }[];
  warnings: string[];
}

const IMAGE_FORMATS = new Set(["png", "jpg", "webp", "gif"]);
const TEXTURE_TYPES = new Set(["texture", "decal", "sprite", "skybox", "ui"]);

const generatedKind = (f: AssetFileRow) => (f.metadata?.generated as string | undefined) ?? null;
const baseName = (f: AssetFileRow) => f.original_filename.replace(/\.[^.]+$/, "");

export async function generateDerivatives(tx: Tx, storage: AssetStorage, assetId: string, opts: DeriveOptions = {}): Promise<DeriveResult> {
  const result: DeriveResult = { created: [], warnings: [] };
  const asset = await tx.asUser((q) => getAssetById(q, assetId));
  if (!asset) throw new Error("Asset not found.");
  let files = await tx.asUser((q) => listAssetFiles(q, assetId));

  if (opts.force) {
    for (const f of files.filter((x) => generatedKind(x))) {
      await tx.asUser((q) => softDeleteFile(q, assetId, f.id));
      if (f.public_key) await storage.delete("public", f.public_key).catch(() => {});
      await storage.delete("private", f.storage_key).catch(() => {});
    }
    files = await tx.asUser((q) => listAssetFiles(q, assetId));
  }

  const read = async (f: AssetFileRow) => {
    const bytes = await storage.get("private", f.storage_key);
    if (!bytes) throw new Error(`Stored file ${f.original_filename} is missing from storage.`);
    return bytes;
  };
  const store = async (input: Parameters<typeof storeAssetFile>[2]) => {
    const r = await tx.asUser((q) => storeAssetFile(q, storage, input));
    if (!r.duplicate) result.created.push({ purpose: r.file.purpose, filename: r.file.original_filename, generated: String(input.extraMetadata?.generated) });
    return r.file;
  };

  if (asset.asset_type === "model" || asset.asset_type === "pack" || asset.asset_type === "animation") {
    // 1. FBX → GLB, unless a GLB is already present.
    const hasGlb = files.some((f) => f.format === "glb" && f.purpose !== "source");
    const fbx = files.find((f) => f.format === "fbx" && f.is_primary) ?? files.find((f) => f.format === "fbx");
    if (!hasGlb && fbx) {
      const images = files.filter((f) => IMAGE_FORMATS.has(f.format));
      try {
        const conv = await convertFbxToGlb(await read(fbx), async (ref) => {
          const wanted = textureBasename(ref);
          const hit = images.find((f) => f.original_filename.toLowerCase() === wanted);
          return hit ? read(hit) : null;
        });
        result.warnings.push(...conv.warnings);
        await store({
          assetId,
          purpose: "delivery",
          filename: `${baseName(fbx)}.glb`,
          bytes: conv.glb,
          primary: !files.some((f) => f.purpose === "delivery" && f.is_primary && f.format !== "fbx"),
          derivedFromFileId: fbx.id,
          extraMetadata: { generated: "fbx-to-glb", note: "Converted automatically from the original FBX." },
        });
        files = await tx.asUser((q) => listAssetFiles(q, assetId));
      } catch (e) {
        result.warnings.push(e instanceof Error ? e.message : "FBX conversion failed.");
      }
    }

    // 2. Thumbnail from the primary GLB when none was uploaded by hand.
    const hasThumb = files.some((f) => f.purpose === "thumbnail");
    const glb =
      files.find((f) => f.format === "glb" && f.purpose === "delivery" && f.is_primary) ??
      files.find((f) => f.format === "glb" && f.purpose === "preview") ??
      files.find((f) => f.format === "glb");
    if (!hasThumb && glb) {
      try {
        await store({
          assetId,
          purpose: "thumbnail",
          filename: `${baseName(glb)}-thumb.webp`,
          bytes: await modelThumbnail(await read(glb)),
          primary: true,
          derivedFromFileId: glb.id,
          extraMetadata: { generated: "model-thumbnail" },
        });
      } catch (e) {
        result.warnings.push(`Thumbnail could not be rendered: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  if (TEXTURE_TYPES.has(asset.asset_type)) {
    const source =
      files.find((f) => f.purpose === "delivery" && f.is_primary && IMAGE_FORMATS.has(f.format) && !f.metadata?.generated) ??
      files.find((f) => f.purpose === "delivery" && IMAGE_FORMATS.has(f.format) && !f.metadata?.generated);
    if (source) {
      const bytes = await read(source);
      if (!files.some((f) => f.purpose === "thumbnail")) {
        await store({
          assetId,
          purpose: "thumbnail",
          filename: `${baseName(source)}-thumb.webp`,
          bytes: await imageThumbnail(bytes),
          primary: true,
          derivedFromFileId: source.id,
          extraMetadata: { generated: "texture-thumbnail" },
        });
      }
      if (opts.textureVariants) {
        for (const v of await textureVariants(bytes)) {
          if (files.some((f) => f.size_variant === v.size && f.metadata?.generated === "texture-variant")) continue;
          await store({
            assetId,
            purpose: "delivery",
            filename: `${baseName(source)}_${v.size}.png`,
            bytes: v.png,
            derivedFromFileId: source.id,
            sizeVariant: v.size,
            extraMetadata: { generated: "texture-variant", note: `Nearest-neighbour downscale to ${v.size}px.` },
          });
        }
      }
    } else {
      result.warnings.push("Upload a texture image as a delivery file to generate a thumbnail.");
    }
  }

  await tx.asUser((q) => recomputeAssetFacets(q, assetId));
  return result;
}
