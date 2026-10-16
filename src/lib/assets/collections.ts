/**
 * Collections: curated packs of published assets with a prebuilt pack ZIP
 * containing every member's delivery files and a licence notice per asset.
 */
import { randomUUID } from "node:crypto";
import { zipSync, type Zippable } from "fflate";
import { z } from "zod";
import type { Queryable, Tx } from "@/lib/db";
import { absoluteUrl } from "@/lib/site";
import { IMMUTABLE_CACHE, keys, type AssetStorage } from "@/lib/storage";
import { sha256Hex } from "@/lib/auth/tokens";
import { licenceText, uniqueNames, type LicenceInfo } from "./bundle";
import { slugify } from "./schemas";

export const collectionInputSchema = z.object({
  title: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .max(80)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  summary: z.string().trim().max(240).default(""),
  descriptionMd: z.string().max(20_000).default(""),
  featured: z.boolean().default(false),
  assetIds: z.array(z.uuid()).max(500).default([]),
});
export type CollectionInput = z.infer<typeof collectionInputSchema>;

export interface CollectionRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  description_md: string;
  status: "draft" | "review" | "published" | "archived";
  featured: boolean;
  cover_url: string | null;
  bundle_key: string | null;
  bundle_public_key: string | null;
  bundle_size_bytes: number | null;
  bundle_sha256: string | null;
  bundle_built_at: Date | null;
  published_at: Date | null;
  updated_at: Date;
}

export async function createCollection(q: Queryable, input: CollectionInput): Promise<CollectionRow> {
  const base = slugify(input.slug || input.title);
  const taken = new Set((await q.query<{ slug: string }>("select slug from collections where slug = $1 or slug like $1 || '-%'", [base])).map((r) => r.slug));
  let slug = base;
  for (let i = 2; taken.has(slug); i++) slug = `${base}-${i}`;
  const [row] = await q.query<CollectionRow>(
    "insert into collections (slug, title, summary, description_md, featured) values ($1,$2,$3,$4,$5) returning *",
    [slug, input.title, input.summary, input.descriptionMd, input.featured],
  );
  await setCollectionAssets(q, row!.id, input.assetIds);
  return row!;
}

export async function updateCollection(q: Queryable, id: string, input: Partial<CollectionInput>): Promise<CollectionRow> {
  const [row] = await q.query<CollectionRow>(
    `update collections set title = coalesce($2, title), summary = coalesce($3, summary), description_md = coalesce($4, description_md),
       featured = coalesce($5, featured) where id = $1 returning *`,
    [id, input.title ?? null, input.summary ?? null, input.descriptionMd ?? null, input.featured ?? null],
  );
  if (!row) throw new Error("Collection not found, or you can't edit it in its current state.");
  if (input.assetIds) await setCollectionAssets(q, id, input.assetIds);
  return row;
}

export async function setCollectionAssets(q: Queryable, collectionId: string, assetIds: string[]): Promise<void> {
  await q.query("delete from collection_assets where collection_id = $1", [collectionId]);
  for (const [i, id] of [...new Set(assetIds)].entries()) {
    await q.query("insert into collection_assets (collection_id, asset_id, position) values ($1, $2, $3)", [collectionId, id, i]);
  }
}

interface MemberRow {
  id: string;
  slug: string;
  title: string;
  status: string;
  asset_type: string;
  thumbnail_url: string | null;
  attribution_text: string | null;
  licence_source_url: string | null;
  provenance_notes: string | null;
  licence: LicenceInfo | null;
}

async function members(q: Queryable, collectionId: string): Promise<MemberRow[]> {
  return q.query<MemberRow>(
    `select a.id, a.slug, a.title, a.status, a.asset_type, a.thumbnail_url, a.attribution_text, a.licence_source_url, a.provenance_notes,
            to_jsonb(l.*) as licence
       from collection_assets ca join assets a on a.id = ca.asset_id left join licences l on l.id = a.licence_id
      where ca.collection_id = $1 and a.deleted_at is null order by ca.position`,
    [collectionId],
  );
}

export class CollectionPublishError extends Error {}

/** Builds the pack ZIP and publishes. Every member must already be published. */
export async function publishCollection(tx: Tx, storage: AssetStorage, collectionId: string): Promise<CollectionRow> {
  const [col] = await tx.asUser((q) => q.query<CollectionRow>("select * from collections where id = $1 and deleted_at is null", [collectionId]));
  if (!col) throw new CollectionPublishError("Collection not found.");
  const list = await tx.asUser((q) => members(q, collectionId));
  if (!list.length) throw new CollectionPublishError("Add at least one asset before publishing.");
  const unpublished = list.filter((m) => m.status !== "published");
  if (unpublished.length) throw new CollectionPublishError(`Publish these assets first: ${unpublished.map((m) => m.title).join(", ")}.`);
  const blocked = list.filter((m) => !m.licence?.redistribution_allowed);
  if (blocked.length) throw new CollectionPublishError(`These assets' licences don't allow redistribution in a pack: ${blocked.map((m) => m.title).join(", ")}.`);

  const mtime = col.published_at ? new Date(col.published_at) : new Date();
  const entries: Zippable = {};
  const enc = new TextEncoder();
  const manifestAssets = [];
  const notice = [`${col.title} — licence notices`, "", "Each asset keeps its own licence. Read every notice below before use.", ""];
  for (const m of list) {
    const files = await tx.asUser((q) =>
      q.query<{ storage_key: string; original_filename: string; format: string; size_bytes: number }>(
        "select storage_key, original_filename, format, size_bytes from asset_files where asset_id = $1 and purpose = 'delivery' and published and deleted_at is null order by original_filename",
        [m.id],
      ),
    );
    const names = uniqueNames(files.map((f) => f.original_filename));
    const fileEntries = [];
    for (const [i, f] of files.entries()) {
      const bytes = await storage.get("private", f.storage_key);
      if (!bytes) throw new CollectionPublishError(`A file of "${m.title}" is missing from storage.`);
      entries[`${col.slug}/${m.slug}/files/${names[i]}`] = [bytes, { mtime }];
      fileEntries.push({ path: `${m.slug}/files/${names[i]}`, bytes: bytes.byteLength, sha256: sha256Hex(bytes), format: f.format });
    }
    const url = absoluteUrl(`/${m.asset_type === "texture" ? "textures" : "assets"}/${m.slug}`);
    const text = licenceText({ title: m.title, url, attributionText: m.attribution_text, licenceSourceUrl: m.licence_source_url, provenance: m.provenance_notes }, m.licence!);
    entries[`${col.slug}/${m.slug}/LICENSE.txt`] = [enc.encode(text), { mtime }];
    notice.push(`## ${m.title}`, text, "");
    manifestAssets.push({ slug: m.slug, title: m.title, licence: m.licence!.code, url, files: fileEntries });
  }
  entries[`${col.slug}/NOTICE.txt`] = [enc.encode(notice.join("\n")), { mtime }];
  entries[`${col.slug}/manifest.json`] = [
    enc.encode(JSON.stringify({ schema: "lowpo11y.collection-bundle/1", collection: { slug: col.slug, title: col.title, url: absoluteUrl(`/collections/${col.slug}`) }, assets: manifestAssets }, null, 2) + "\n"),
    { mtime },
  ];
  const ordered: Zippable = {};
  for (const k of Object.keys(entries).sort()) ordered[k] = entries[k]!;
  const zip = zipSync(ordered, { level: 6 });
  const sha = sha256Hex(zip);
  const key = keys.collectionBundle(collectionId, `${sha.slice(0, 12)}-${randomUUID().slice(0, 8)}`);
  await storage.put("private", key, zip, { contentType: "application/zip", downloadName: `${col.slug}.zip` });
  await storage.copy({ bucket: "private", key }, { bucket: "public", key }, { contentType: "application/zip", downloadName: `${col.slug}.zip`, cacheControl: IMMUTABLE_CACHE });
  if (col.bundle_public_key && col.bundle_public_key !== key) await storage.delete("public", col.bundle_public_key).catch(() => {});

  const cover = list.find((m) => m.thumbnail_url)?.thumbnail_url ?? null;
  const [row] = await tx.asUser((q) =>
    q.query<CollectionRow>(
      `update collections set status = 'published', published_at = coalesce(published_at, $2), bundle_key = $3, bundle_public_key = $3,
         bundle_size_bytes = $4, bundle_sha256 = $5, bundle_built_at = now(), cover_url = coalesce(cover_url, $6) where id = $1 returning *`,
      [collectionId, mtime, key, zip.byteLength, sha, cover],
    ),
  );
  return row!;
}

export async function unpublishCollection(tx: Tx, storage: AssetStorage, collectionId: string): Promise<void> {
  const [col] = await tx.asUser((q) => q.query<CollectionRow>("select * from collections where id = $1", [collectionId]));
  if (col?.bundle_public_key) await storage.delete("public", col.bundle_public_key).catch(() => {});
  await tx.asUser((q) => q.query("update collections set status = 'archived', bundle_public_key = null where id = $1", [collectionId]));
}

export interface PublicCollection extends CollectionRow {
  asset_count: number;
}

export async function listPublicCollections(q: Queryable): Promise<PublicCollection[]> {
  return q.query<PublicCollection>(
    `select c.*, (select count(*)::int from collection_assets ca join assets a on a.id = ca.asset_id
                   where ca.collection_id = c.id and a.status = 'published' and a.deleted_at is null) as asset_count
       from collections c where c.status = 'published' and c.deleted_at is null order by c.featured desc, c.sort_order, c.published_at desc`,
  );
}

export async function getPublicCollection(q: Queryable, slug: string) {
  const [col] = await q.query<CollectionRow>("select * from collections where slug = $1 and status = 'published' and deleted_at is null", [slug]);
  if (!col) return null;
  const items = await q.query<{ id: string; slug: string; title: string; asset_type: string; thumbnail_url: string | null; licence_short: string | null; triangle_count: number | null; texture_size: number | null; formats: string[]; short_description: string; is_demo: boolean }>(
    `select a.id, a.slug, a.title, a.asset_type, a.thumbnail_url, l.short_label as licence_short, a.triangle_count, a.texture_size, a.formats, a.short_description, a.is_demo
       from collection_assets ca join assets a on a.id = ca.asset_id left join licences l on l.id = a.licence_id
      where ca.collection_id = $1 and a.status = 'published' and a.deleted_at is null order by ca.position`,
    [col.id],
  );
  return { collection: col, items };
}
