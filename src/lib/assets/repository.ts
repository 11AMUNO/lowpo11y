/**
 * Asset persistence. Every function takes a Queryable that already runs in
 * the right context (staff RLS for admin writes, public for catalogue reads).
 */
import type { Queryable } from "@/lib/db";
import type { AssetFileRow } from "./files";
import { slugify, tagSlug, type AssetInput, type AssetPatch, type AssetType } from "./schemas";

export interface AssetRow {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  description_md: string;
  usage_notes_md: string;
  asset_type: AssetType;
  status: "draft" | "review" | "published" | "archived";
  category_id: string | null;
  licence_id: string | null;
  attribution_text: string | null;
  licence_source_url: string | null;
  provenance_kind: string | null;
  provenance_notes: string | null;
  ownership_attested_at: Date | null;
  ownership_attested_by: string | null;
  featured: boolean;
  is_demo: boolean;
  version: number;
  formats: string[];
  engines: string[];
  triangle_count: number | null;
  vertex_count: number | null;
  texture_size: number | null;
  is_animated: boolean;
  is_rigged: boolean;
  bounds_mm: number[] | null;
  download_count: number;
  bundle_file_id: string | null;
  thumbnail_url: string | null;
  published_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export class AssetInputError extends Error {}

async function uniqueSlug(q: Queryable, base: string, exceptId?: string): Promise<string> {
  const root = slugify(base);
  const rows = await q.query<{ slug: string }>("select slug from assets where (slug = $1 or slug like $1 || '-%') and ($2::uuid is null or id <> $2::uuid)", [
    root,
    exceptId ?? null,
  ]);
  const taken = new Set(rows.map((r) => r.slug));
  if (!taken.has(root)) return root;
  for (let i = 2; i < 10_000; i++) if (!taken.has(`${root}-${i}`)) return `${root}-${i}`;
  throw new AssetInputError("Could not find a free slug.");
}

/** Ensures tags exist (new ones get the general facet) and returns their ids. */
export async function ensureTags(q: Queryable, names: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const name of [...new Set(names.map((n) => n.trim()).filter(Boolean))]) {
    const s = tagSlug(name);
    const [row] = await q.query<{ id: string }>(
      `insert into tags (slug, name) values ($1, $2) on conflict (slug) do update set slug = excluded.slug returning id`,
      [s, name],
    );
    ids.push(row!.id);
  }
  return ids;
}

export async function setAssetTags(q: Queryable, assetId: string, names: string[]): Promise<void> {
  const ids = await ensureTags(q, names);
  await q.query("delete from asset_tags where asset_id = $1 and not (tag_id = any($2::uuid[]))", [assetId, ids]);
  for (const id of ids) await q.query("insert into asset_tags (asset_id, tag_id) values ($1, $2) on conflict do nothing", [assetId, id]);
}

export async function createAsset(q: Queryable, actorId: string | null, input: AssetInput, opts: { isDemo?: boolean } = {}): Promise<AssetRow> {
  const slug = await uniqueSlug(q, input.slug || input.title);
  const [row] = await q.query<AssetRow>(
    `insert into assets (slug, title, asset_type, short_description, description_md, usage_notes_md, category_id, licence_id,
        attribution_text, licence_source_url, provenance_kind, provenance_notes, featured, engines, is_demo, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::text[],$15,$16) returning *`,
    [
      slug,
      input.title,
      input.assetType,
      input.shortDescription,
      input.descriptionMd,
      input.usageNotesMd,
      input.categoryId,
      input.licenceId,
      input.attributionText,
      input.licenceSourceUrl,
      input.provenanceKind,
      input.provenanceNotes,
      input.featured,
      input.engines,
      opts.isDemo ?? false,
      actorId,
    ],
  );
  if (input.tags.length) await setAssetTags(q, row!.id, input.tags);
  return row!;
}

const PATCH_COLUMNS: Record<string, string> = {
  title: "title",
  assetType: "asset_type",
  shortDescription: "short_description",
  descriptionMd: "description_md",
  usageNotesMd: "usage_notes_md",
  categoryId: "category_id",
  licenceId: "licence_id",
  attributionText: "attribution_text",
  licenceSourceUrl: "licence_source_url",
  provenanceKind: "provenance_kind",
  provenanceNotes: "provenance_notes",
  featured: "featured",
};

export async function updateAsset(q: Queryable, actorId: string, id: string, patch: AssetPatch): Promise<AssetRow> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const add = (sql: string, value: unknown) => {
    params.push(value);
    sets.push(sql.replace("?", `$${params.length}`));
  };
  for (const [key, column] of Object.entries(PATCH_COLUMNS)) {
    const v = (patch as Record<string, unknown>)[key];
    if (v !== undefined) add(`${column} = ?`, v);
  }
  if (patch.engines !== undefined) add("engines = ?::text[]", patch.engines);
  if (patch.status !== undefined) add("status = ?::publish_status", patch.status);
  // Attestation covers the licence it was given under: a different licence
  // clears it, and confirming again restamps who and when. SET expressions
  // see the old row, so licence_id here is the current value.
  let changed = "false";
  if (patch.licenceId !== undefined) {
    params.push(patch.licenceId);
    changed = `licence_id is distinct from $${params.length}::uuid`;
  }
  if (patch.attest === true) {
    params.push(actorId);
    const actor = `$${params.length}::uuid`;
    sets.push(
      `ownership_attested_at = case when ownership_attested_at is null or ${changed} then now() else ownership_attested_at end`,
      `ownership_attested_by = case when ownership_attested_at is null or ${changed} then ${actor} else ownership_attested_by end`,
    );
  } else if (patch.attest === false) {
    sets.push("ownership_attested_at = null, ownership_attested_by = null");
  } else if (patch.licenceId !== undefined) {
    sets.push(`ownership_attested_at = case when ${changed} then null else ownership_attested_at end`, `ownership_attested_by = case when ${changed} then null else ownership_attested_by end`);
  }
  let row: AssetRow | undefined;
  if (sets.length) {
    [row] = await q.query<AssetRow>(`update assets set ${sets.join(", ")} where id = $1 and deleted_at is null returning *`, params);
  } else {
    [row] = await q.query<AssetRow>("select * from assets where id = $1", [id]);
  }
  if (!row) throw new AssetInputError("Asset not found, or you can't edit it in its current state.");
  if (patch.tags !== undefined) await setAssetTags(q, id, patch.tags);
  return row;
}

export async function getAssetById(q: Queryable, id: string): Promise<AssetRow | null> {
  const [row] = await q.query<AssetRow>("select * from assets where id = $1", [id]);
  return row ?? null;
}

export async function listAssetFiles(q: Queryable, assetId: string): Promise<AssetFileRow[]> {
  return q.query<AssetFileRow>(
    "select * from asset_files where asset_id = $1 and deleted_at is null order by purpose, is_primary desc, sort_order, size_variant desc nulls first, created_at",
    [assetId],
  );
}

export async function listAssetTags(q: Queryable, assetId: string): Promise<{ id: string; slug: string; name: string; facet: string }[]> {
  return q.query("select t.id, t.slug, t.name, t.facet from asset_tags at join tags t on t.id = at.tag_id where at.asset_id = $1 order by t.facet, t.name", [assetId]);
}

export async function setFileFlags(
  q: Queryable,
  assetId: string,
  fileId: string,
  flags: { isPrimary?: boolean; published?: boolean; sortOrder?: number },
): Promise<void> {
  if (flags.isPrimary) {
    const [f] = await q.query<{ purpose: string }>("select purpose from asset_files where id = $1 and asset_id = $2", [fileId, assetId]);
    if (!f) throw new AssetInputError("File not found.");
    await q.query("update asset_files set is_primary = (id = $2) where asset_id = $1 and purpose = $3", [assetId, fileId, f.purpose]);
  }
  if (flags.published !== undefined) await q.query("update asset_files set published = $3 where id = $2 and asset_id = $1", [assetId, fileId, flags.published]);
  if (flags.sortOrder !== undefined) await q.query("update asset_files set sort_order = $3 where id = $2 and asset_id = $1", [assetId, fileId, flags.sortOrder]);
}

export async function softDeleteFile(q: Queryable, assetId: string, fileId: string): Promise<AssetFileRow | null> {
  const [row] = await q.query<AssetFileRow>(
    "update asset_files set deleted_at = now(), is_primary = false where id = $2 and asset_id = $1 and deleted_at is null returning *",
    [assetId, fileId],
  );
  return row ?? null;
}

/**
 * Derives the catalogue facets (formats, triangle count, texture size, rig and
 * animation flags, bounds) from the asset's live delivery/preview files, so
 * filters only ever reflect real file metadata.
 */
export async function recomputeAssetFacets(q: Queryable, assetId: string): Promise<void> {
  const files = await q.query<AssetFileRow & { metadata: Record<string, unknown> }>(
    "select * from asset_files where asset_id = $1 and deleted_at is null and published and purpose in ('delivery', 'preview')",
    [assetId],
  );
  const delivery = files.filter((f) => f.purpose === "delivery");
  const formats = [...new Set(delivery.map((f) => f.format))].sort();
  const models = files.filter((f) => f.model_triangle_count !== null);
  const primaryModel = models.find((f) => f.is_primary && f.purpose === "delivery") ?? models.find((f) => f.purpose === "preview") ?? models[0];
  const images = delivery.filter((f) => f.width && f.height);
  const textureSize = images.length ? Math.max(...images.map((f) => Math.max(f.width!, f.height!))) : null;
  const meta = (primaryModel?.metadata?.model ?? {}) as { animations?: unknown[]; skins?: number; bounds?: { size?: number[] } };
  const bounds = meta.bounds?.size?.map((v) => Math.round(v * 1000)) ?? null;
  await q.query(
    `update assets set formats = $2::text[], triangle_count = $3, vertex_count = $4, texture_size = $5,
       is_animated = $6, is_rigged = $7, bounds_mm = $8::int[] where id = $1`,
    [
      assetId,
      formats,
      primaryModel?.model_triangle_count ?? null,
      primaryModel?.model_vertex_count ?? null,
      textureSize,
      (meta.animations?.length ?? 0) > 0,
      (meta.skins ?? 0) > 0,
      bounds,
    ],
  );
}
