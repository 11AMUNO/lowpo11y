/**
 * Published models the Scene Builder can place: model assets whose licence
 * allows downloading and that have a GLB download. Textures come from the
 * Workshop's library query. Public RLS context; files are fetched through the
 * normal download route, so they're counted like any other download.
 */
import type { Queryable } from "@/lib/db";

export interface LibraryModel {
  assetId: string;
  slug: string;
  title: string;
  thumbnail: string | null;
  licence: string | null;
  attribution: boolean;
  fileId: string;
  filename: string;
  sizeBytes: number;
  triangles: number | null;
}

export async function sceneModels(q: Queryable, text = "", limit = 60): Promise<LibraryModel[]> {
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
    thumbnail_url: string | null;
    licence: string | null;
    attribution_required: boolean | null;
    file_id: string;
    original_filename: string;
    size_bytes: string | number;
    model_triangle_count: number | null;
  }>(
    `select a.id, a.slug, a.title, a.thumbnail_url, l.short_label as licence, l.attribution_required,
            f.id as file_id, f.original_filename, f.size_bytes, f.model_triangle_count
       from assets a
       join licences l on l.id = a.licence_id and l.allows_download
       join lateral (
         select f.* from asset_files f
          where f.asset_id = a.id and f.purpose = 'delivery' and f.published and f.deleted_at is null
            and f.public_key is not null and f.format = 'glb'
          order by f.is_primary desc, f.size_bytes, f.id
          limit 1
       ) f on true
      where a.status = 'published' and a.deleted_at is null and a.asset_type = 'model' ${filter}
      order by a.published_at desc nulls last, a.title
      limit $1`,
    params,
  );
  return rows.map((r) => ({
    assetId: r.id,
    slug: r.slug,
    title: r.title,
    thumbnail: r.thumbnail_url,
    licence: r.licence,
    attribution: !!r.attribution_required,
    fileId: r.file_id,
    filename: r.original_filename,
    sizeBytes: Number(r.size_bytes),
    triangles: r.model_triangle_count,
  }));
}
