/**
 * Published textures the Workshop can open: texture-like assets whose
 * licence allows downloading and that have a PNG, JPG or WebP download.
 * Runs in the public RLS context. The image itself is fetched through the
 * normal download route, so it's counted like any other download.
 */
import type { Queryable } from "@/lib/db";

export interface LibraryTexture {
  assetId: string;
  slug: string;
  title: string;
  type: string;
  thumbnail: string | null;
  licence: string | null;
  attribution: boolean;
  fileId: string;
  filename: string;
  width: number | null;
  height: number | null;
  sizeBytes: number;
}

export async function workshopLibrary(q: Queryable, text = "", limit = 48): Promise<LibraryTexture[]> {
  const params: unknown[] = [limit];
  let filter = "";
  if (text.trim()) {
    params.push(`%${text.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    filter = "and (a.title ilike $2 or a.slug ilike $2)";
  }
  const rows = await q.query<{
    id: string;
    slug: string;
    title: string;
    asset_type: string;
    thumbnail_url: string | null;
    licence: string | null;
    attribution_required: boolean | null;
    file_id: string;
    original_filename: string;
    width: number | null;
    height: number | null;
    size_bytes: string | number;
  }>(
    `select a.id, a.slug, a.title, a.asset_type, a.thumbnail_url, l.short_label as licence, l.attribution_required,
            f.id as file_id, f.original_filename, f.width, f.height, f.size_bytes
       from assets a
       join licences l on l.id = a.licence_id and l.allows_download
       join lateral (
         select f.* from asset_files f
          where f.asset_id = a.id and f.purpose = 'delivery' and f.published and f.deleted_at is null
            and f.public_key is not null and f.format in ('png', 'jpg', 'jpeg', 'webp')
          order by f.is_primary desc, coalesce(f.width, 0) * coalesce(f.height, 0) desc, f.id
          limit 1
       ) f on true
      where a.status = 'published' and a.deleted_at is null and a.asset_type in ('texture', 'decal', 'sprite', 'ui') ${filter}
      order by a.published_at desc nulls last, a.title
      limit $1`,
    params,
  );
  return rows.map((r) => ({
    assetId: r.id,
    slug: r.slug,
    title: r.title,
    type: r.asset_type,
    thumbnail: r.thumbnail_url,
    licence: r.licence,
    attribution: !!r.attribution_required,
    fileId: r.file_id,
    filename: r.original_filename,
    width: r.width,
    height: r.height,
    sizeBytes: Number(r.size_bytes),
  }));
}
