/**
 * Publishing: validate, copy published files to the public bucket, build the
 * download bundle, flip the status. Unpublishing removes public copies
 * immediately (originals stay private).
 */
import type { Tx } from "@/lib/db";
import { absoluteUrl } from "@/lib/site";
import { IMMUTABLE_CACHE, type AssetStorage } from "@/lib/storage";
import { buildAssetBundle, type LicenceInfo } from "./bundle";
import { storeAssetFile, type AssetFileRow } from "./files";
import { getAssetById, listAssetFiles, recomputeAssetFacets, type AssetRow } from "./repository";
import { ASSET_TYPE_LABEL, assetPath, PROVENANCE_LABEL } from "./schemas";

export interface ChecklistItem {
  id: string;
  label: string;
  ok: boolean;
  /** Blocking items prevent publishing; others are advice. */
  blocking: boolean;
}

export function publishChecklist(asset: AssetRow, files: AssetFileRow[], licence: LicenceInfo | null): ChecklistItem[] {
  const live = files.filter((f) => f.published);
  return [
    { id: "licence", label: "A known licence is chosen", ok: !!licence && licence.code !== "unknown", blocking: true },
    { id: "attested", label: "Ownership or redistribution rights are confirmed", ok: !!asset.ownership_attested_at, blocking: true },
    { id: "delivery", label: "At least one downloadable file", ok: live.some((f) => f.purpose === "delivery"), blocking: true },
    { id: "thumbnail", label: "A thumbnail", ok: live.some((f) => f.purpose === "thumbnail"), blocking: true },
    { id: "description", label: "A short description", ok: asset.short_description.trim().length >= 10, blocking: false },
    { id: "category", label: "A category", ok: !!asset.category_id, blocking: false },
    {
      id: "attribution",
      label: "Attribution text (the licence requires credit)",
      ok: !licence?.attribution_required || !!asset.attribution_text?.trim(),
      blocking: false,
    },
  ];
}

export class PublishError extends Error {
  constructor(
    message: string,
    readonly checklist?: ChecklistItem[],
  ) {
    super(message);
  }
}

async function loadLicence(tx: Tx, id: string | null): Promise<LicenceInfo | null> {
  if (!id) return null;
  const [row] = await tx.asUser((q) => q.query<LicenceInfo>("select * from licences where id = $1", [id]));
  return row ?? null;
}

function stats(asset: AssetRow): string[] {
  const out = [`Type: ${ASSET_TYPE_LABEL[asset.asset_type]}`];
  if (asset.triangle_count) out.push(`Triangles: ${asset.triangle_count.toLocaleString("en-GB")}`);
  if (asset.texture_size) out.push(`Largest texture: ${asset.texture_size}px`);
  if (asset.bounds_mm) out.push(`Bounds: ${asset.bounds_mm.map((v) => (v / 1000).toFixed(2)).join(" × ")} units`);
  if (asset.formats.length) out.push(`Formats: ${asset.formats.join(", ").toUpperCase()}`);
  return out;
}

export async function publishAsset(tx: Tx, storage: AssetStorage, assetId: string): Promise<AssetRow> {
  let asset = await tx.asUser((q) => getAssetById(q, assetId));
  if (!asset || asset.deleted_at) throw new PublishError("Asset not found.");
  await tx.asUser((q) => recomputeAssetFacets(q, assetId));
  asset = (await tx.asUser((q) => getAssetById(q, assetId)))!;
  let files = await tx.asUser((q) => listAssetFiles(q, assetId));
  const licence = await loadLicence(tx, asset.licence_id);
  const checklist = publishChecklist(asset, files, licence);
  const missing = checklist.filter((c) => c.blocking && !c.ok);
  if (missing.length) throw new PublishError(`Not ready to publish: ${missing.map((m) => m.label.toLowerCase()).join("; ")}.`, checklist);

  // Verify every published file still exists before exposing anything.
  for (const f of files.filter((x) => x.published)) {
    const head = await storage.head("private", f.storage_key);
    if (!head || head.size !== Number(f.size_bytes)) throw new PublishError(`Stored file ${f.original_filename} is missing or damaged. Re-upload it.`);
  }

  // Bundle: all published delivery files plus licence, readme and manifest.
  const publishedAt = asset.published_at ? new Date(asset.published_at) : new Date();
  const delivery = files.filter((f) => f.published && f.purpose === "delivery");
  const bundleFiles = [];
  for (const f of delivery) {
    const bytes = await storage.get("private", f.storage_key);
    if (!bytes) throw new PublishError(`Stored file ${f.original_filename} is missing.`);
    bundleFiles.push({
      filename: f.original_filename,
      bytes,
      format: f.format,
      width: f.width,
      height: f.height,
      triangles: f.model_triangle_count,
      note: (f.metadata?.note as string | undefined) ?? undefined,
    });
  }
  const zip = buildAssetBundle(
    {
      slug: asset.slug,
      title: asset.title,
      shortDescription: asset.short_description,
      type: asset.asset_type,
      version: asset.version,
      url: absoluteUrl(assetPath(asset)),
      publishedAt,
      attributionText: asset.attribution_text,
      licenceSourceUrl: asset.licence_source_url,
      provenance: asset.provenance_kind ? `${PROVENANCE_LABEL[asset.provenance_kind as keyof typeof PROVENANCE_LABEL] ?? asset.provenance_kind}${asset.provenance_notes ? ` — ${asset.provenance_notes}` : ""}` : null,
      usageNotes: asset.usage_notes_md,
      stats: stats(asset),
    },
    licence!,
    bundleFiles,
  );
  const previousBundles = files.filter((f) => f.purpose === "bundle");
  const { file: bundle } = await tx.asUser((q) =>
    storeAssetFile(q, storage, { assetId, purpose: "delivery", filename: `${asset!.slug}.zip`, bytes: zip, extraMetadata: { generated: "bundle" } }),
  );
  // Re-tag the stored ZIP as the bundle (storeAssetFile validates it as a normal delivery ZIP first).
  await tx.asUser((q) => q.query("update asset_files set purpose = 'bundle', is_primary = true where id = $1", [bundle.id]));
  for (const old of previousBundles.filter((b) => b.id !== bundle.id)) {
    await tx.asUser((q) => q.query("update asset_files set deleted_at = now() where id = $1", [old.id]));
    if (old.public_key) await storage.delete("public", old.public_key).catch(() => {});
  }

  // Copy every published file (and the bundle) to the public bucket.
  files = await tx.asUser((q) => listAssetFiles(q, assetId));
  for (const f of files.filter((x) => x.published || x.id === bundle.id)) {
    await storage.copy({ bucket: "private", key: f.storage_key }, { bucket: "public", key: f.storage_key }, {
      contentType: f.mime,
      downloadName: f.original_filename,
      cacheControl: IMMUTABLE_CACHE,
    });
    await tx.asUser((q) => q.query("update asset_files set public_key = storage_key where id = $1", [f.id]));
  }
  // Files no longer published must not stay public.
  for (const f of files.filter((x) => !x.published && x.public_key && x.id !== bundle.id)) {
    await storage.delete("public", f.public_key!).catch(() => {});
    await tx.asUser((q) => q.query("update asset_files set public_key = null where id = $1", [f.id]));
  }

  const thumb = files.find((f) => f.purpose === "thumbnail" && f.is_primary && f.published) ?? files.find((f) => f.purpose === "thumbnail" && f.published);
  const [row] = await tx.asUser((q) =>
    q.query<AssetRow>(
      `update assets set status = 'published', published_at = coalesce(published_at, $2), bundle_file_id = $3, thumbnail_url = $4
        where id = $1 returning *`,
      [assetId, publishedAt, bundle.id, thumb ? storage.publicUrl(thumb.storage_key) : null],
    ),
  );
  return row!;
}

export async function unpublishAsset(tx: Tx, storage: AssetStorage, assetId: string, status: "draft" | "archived" = "archived"): Promise<AssetRow> {
  const files = await tx.asUser((q) => listAssetFiles(q, assetId));
  for (const f of files.filter((x) => x.public_key)) {
    await storage.delete("public", f.public_key!).catch(() => {});
  }
  await tx.asUser((q) => q.query("update asset_files set public_key = null where asset_id = $1", [assetId]));
  const [row] = await tx.asUser((q) =>
    q.query<AssetRow>("update assets set status = $2, thumbnail_url = null where id = $1 returning *", [assetId, status]),
  );
  if (!row) throw new PublishError("Asset not found.");
  return row;
}
