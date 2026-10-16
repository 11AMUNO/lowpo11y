/**
 * Download resolution and privacy-preserving counting: a per-file daily count
 * plus an optional client-generated event id to ignore double clicks. No IP
 * addresses or identifiers are stored.
 */
import type { Queryable } from "@/lib/db";
import { sha256Hex } from "@/lib/auth/tokens";

export interface ResolvedDownload {
  fileId: string;
  assetId: string;
  assetSlug: string;
  filename: string;
  publicKey: string;
  sizeBytes: number;
}

export class DownloadError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Run under the public RLS context: unpublished files and assets are invisible. */
export async function resolveDownload(q: Queryable, fileId: string): Promise<ResolvedDownload> {
  const [row] = await q.query<{
    id: string;
    asset_id: string;
    slug: string;
    original_filename: string;
    public_key: string | null;
    size_bytes: number;
    allows_download: boolean | null;
    purpose: string;
  }>(
    `select f.id, f.asset_id, a.slug, f.original_filename, f.public_key, f.size_bytes, f.purpose, l.allows_download
       from asset_files f join assets a on a.id = f.asset_id left join licences l on l.id = a.licence_id
      where f.id = $1 and f.deleted_at is null and (f.published or f.purpose = 'bundle')`,
    [fileId],
  );
  if (!row || !row.public_key) throw new DownloadError("This file isn't available.", 404);
  if (!row.allows_download) throw new DownloadError("Downloads are blocked until this asset's licence is confirmed.", 403);
  return { fileId: row.id, assetId: row.asset_id, assetSlug: row.slug, filename: row.original_filename, publicKey: row.public_key, sizeBytes: Number(row.size_bytes) };
}

/** Service context. Returns false when the event id was already counted. */
export async function recordDownload(q: Queryable, d: ResolvedDownload, eventId?: string | null, now = new Date()): Promise<boolean> {
  if (eventId && /^[A-Za-z0-9_-]{8,64}$/.test(eventId)) {
    const inserted = await q.query("insert into download_dedupe (key) values ($1) on conflict do nothing returning key", [sha256Hex(`${d.fileId}:${eventId}`)]);
    if (!inserted.length) return false;
  }
  const day = now.toISOString().slice(0, 10);
  await q.query(
    `insert into download_daily (file_id, asset_id, day, downloads) values ($1, $2, $3::date, 1)
     on conflict (file_id, day) do update set downloads = download_daily.downloads + 1`,
    [d.fileId, d.assetId, day],
  );
  await q.query("update assets set download_count = download_count + 1 where id = $1", [d.assetId]);
  return true;
}

export async function pruneDownloadDedupe(q: Queryable, olderThanHours = 24): Promise<void> {
  await q.query("delete from download_dedupe where created_at < now() - ($1 || ' hours')::interval", [String(olderThanHours)]);
}
