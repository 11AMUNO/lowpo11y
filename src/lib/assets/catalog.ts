/**
 * Public catalogue queries. Always run under the public (or user) RLS context,
 * so unpublished rows are invisible even if a query is wrong.
 */
import { z } from "zod";
import type { Queryable } from "@/lib/db";
import { ASSET_TYPES, type AssetType } from "./schemas";

export const PAGE_SIZE = 36;
export const TRI_BUCKETS = { "lt-1k": [0, 999], "1k-5k": [1000, 4999], "5k-20k": [5000, 19999], "gt-20k": [20000, 1e12] } as const;
export const SORTS = ["recent", "popular", "name"] as const;

const csv = (allowed?: readonly string[]) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s && /^[a-z0-9-]{1,60}$/.test(s) && (!allowed || allowed.includes(s)))
        .slice(0, 20),
    );

export const catalogParamsSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  type: csv(ASSET_TYPES).catch([]),
  category: csv().catch([]),
  style: csv().catch([]),
  setting: csv().catch([]),
  tag: csv().catch([]),
  format: csv().catch([]),
  licence: csv().catch([]),
  commercial: z.enum(["1"]).optional().catch(undefined),
  size: csv(["32", "64", "128", "256", "512", "1024", "2048"]).catch([]),
  tris: z.enum(Object.keys(TRI_BUCKETS) as [keyof typeof TRI_BUCKETS]).optional().catch(undefined),
  animated: z.enum(["1"]).optional().catch(undefined),
  rigged: z.enum(["1"]).optional().catch(undefined),
  engine: csv().catch([]),
  sort: z.enum(SORTS).default("recent").catch("recent"),
  view: z.enum(["grid", "list"]).default("grid").catch("grid"),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});
export type CatalogParams = z.infer<typeof catalogParamsSchema>;

export function parseCatalogParams(sp: Record<string, string | string[] | undefined>): CatalogParams {
  const flat: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(sp)) flat[k] = Array.isArray(v) ? v.join(",") : v;
  return catalogParamsSchema.parse(flat);
}

/** Serialises params back to a query string, omitting defaults (canonical URLs). */
export function catalogQuery(p: Partial<CatalogParams>, overrides: Partial<CatalogParams> = {}): string {
  const merged = { ...p, ...overrides };
  const qs = new URLSearchParams();
  const put = (k: string, v: unknown) => {
    if (v === undefined || v === null || v === "") return;
    if (Array.isArray(v)) {
      if (v.length) qs.set(k, v.join(","));
    } else qs.set(k, String(v));
  };
  put("q", merged.q);
  for (const k of ["type", "category", "style", "setting", "tag", "format", "licence", "size", "engine"] as const) put(k, merged[k]);
  put("commercial", merged.commercial);
  put("tris", merged.tris);
  put("animated", merged.animated);
  put("rigged", merged.rigged);
  if (merged.sort && merged.sort !== "recent") put("sort", merged.sort);
  if (merged.view && merged.view !== "grid") put("view", merged.view);
  if (merged.page && merged.page > 1) put("page", merged.page);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

export interface CatalogItem {
  id: string;
  slug: string;
  title: string;
  short_description: string;
  asset_type: AssetType;
  category_name: string | null;
  category_slug: string | null;
  licence_short: string | null;
  licence_code: string | null;
  formats: string[];
  triangle_count: number | null;
  texture_size: number | null;
  thumbnail_url: string | null;
  is_demo: boolean;
  is_animated: boolean;
  is_rigged: boolean;
  download_count: number;
  published_at: Date;
  tag_names: string[] | null;
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface CatalogResult {
  items: CatalogItem[];
  total: number;
  page: number;
  pageCount: number;
  facets: {
    type: FacetOption[];
    category: FacetOption[];
    style: FacetOption[];
    setting: FacetOption[];
    format: FacetOption[];
    licence: FacetOption[];
    size: FacetOption[];
    tris: FacetOption[];
    engine: FacetOption[];
    animated: number;
    rigged: number;
    commercial: number;
  };
}

/** Builds a tsquery for prefix matching ("cra bar" → "cra:* & bar:*"). */
export function prefixQuery(q: string): string | null {
  const tokens = q
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 1)
    .slice(0, 8);
  return tokens.length ? tokens.map((t) => `${t}:*`).join(" & ") : null;
}

interface Built {
  where: string;
  params: unknown[];
}

function buildWhere(p: CatalogParams, scope: { types?: AssetType[] }, omit?: string): Built {
  const params: unknown[] = [];
  const conds = ["a.status = 'published'", "a.deleted_at is null"];
  const add = (sql: string, ...values: unknown[]) => {
    let s = sql;
    for (const v of values) {
      params.push(v);
      s = s.replace("?", `$${params.length}`);
    }
    conds.push(s);
  };
  // A type filter can narrow the page's scope but never escape it.
  const scoped = scope.types?.length ? scope.types : null;
  const chosen = omit === "type" ? [] : p.type.filter((t) => !scoped || (scoped as string[]).includes(t));
  const effective = chosen.length ? chosen : scoped ?? [];
  if (effective.length) add("a.asset_type::text = any(?::text[])", effective);
  if (p.q) {
    const pq = prefixQuery(p.q);
    // Full-text, prefix ("cra" → crate) and typo-tolerant word similarity ("brik wal" → Brick wall).
    add(`(a.search_tsv @@ websearch_to_tsquery('english', ?) ${pq ? "or a.search_tsv @@ to_tsquery('simple', ?)" : ""} or ? <% a.title)`, ...(pq ? [p.q, pq, p.q] : [p.q, p.q]));
  }
  if (omit !== "category" && p.category.length) add("c.slug = any(?::text[])", p.category);
  const tagFacet = (facet: string, slugs: string[]) => {
    if (slugs.length) add(`exists (select 1 from asset_tags at join tags t on t.id = at.tag_id where at.asset_id = a.id and t.facet = '${facet}' and t.slug = any(?::text[]))`, slugs);
  };
  if (omit !== "style") tagFacet("style", p.style);
  if (omit !== "setting") tagFacet("setting", p.setting);
  if (p.tag.length) add("exists (select 1 from asset_tags at join tags t on t.id = at.tag_id where at.asset_id = a.id and t.slug = any(?::text[]))", p.tag);
  if (omit !== "format" && p.format.length) add("a.formats && ?::text[]", p.format);
  if (omit !== "licence" && p.licence.length) add("l.code = any(?::text[])", p.licence);
  if (omit !== "commercial" && p.commercial) conds.push("l.commercial_use is true");
  if (omit !== "size" && p.size.length) add("a.texture_size = any(?::int[])", p.size.map(Number));
  if (omit !== "tris" && p.tris) add("a.triangle_count between ? and ?", ...TRI_BUCKETS[p.tris]);
  if (omit !== "animated" && p.animated) conds.push("a.is_animated");
  if (omit !== "rigged" && p.rigged) conds.push("a.is_rigged");
  if (omit !== "engine" && p.engine.length) add("a.engines && ?::text[]", p.engine);
  return { where: conds.join(" and "), params };
}

const FROM = "from assets a left join categories c on c.id = a.category_id left join licences l on l.id = a.licence_id";

async function listItems(q: Queryable, p: CatalogParams, scope: { types?: AssetType[] }, limit: number, offset: number): Promise<{ items: CatalogItem[]; total: number }> {
  if (p.q) await q.query("select set_config('pg_trgm.word_similarity_threshold', '0.5', true)");
  const { where, params } = buildWhere(p, scope);
  const order =
    p.sort === "popular" ? "a.download_count desc, a.published_at desc" : p.sort === "name" ? `lower(a.title) collate "C" asc` : "a.featured desc, a.published_at desc";
  const rank = p.q ? `ts_rank(a.search_tsv, websearch_to_tsquery('english', $${params.length + 1})) + word_similarity($${params.length + 1}, a.title) desc, ` : "";
  const listParams = p.q ? [...params, p.q] : [...params];
  const [items, [count]] = await Promise.all([
    q.query<CatalogItem>(
      `select a.id, a.slug, a.title, a.short_description, a.asset_type, c.name as category_name, c.slug as category_slug,
              l.short_label as licence_short, l.code as licence_code, a.formats, a.triangle_count, a.texture_size, a.thumbnail_url,
              a.is_demo, a.is_animated, a.is_rigged, a.download_count, a.published_at,
              (select array_agg(t.name order by t.name) from asset_tags at join tags t on t.id = at.tag_id where at.asset_id = a.id and t.facet in ('style','setting','general')) as tag_names
       ${FROM} where ${where} order by ${p.sort === "recent" ? rank : ""}${order}, a.id limit ${Math.floor(limit)} offset ${Math.floor(offset)}`,
      listParams,
    ),
    q.query<{ n: number }>(`select count(*)::int as n ${FROM} where ${where}`, params),
  ]);
  return { items, total: count?.n ?? 0 };
}

export async function searchCatalog(q: Queryable, p: CatalogParams, scope: { types?: AssetType[] } = {}): Promise<CatalogResult> {
  const { items, total } = await listItems(q, p, scope, PAGE_SIZE, (p.page - 1) * PAGE_SIZE);
  return { items, total, page: p.page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)), facets: await facets(q, p, scope) };
}

/** Best matches for the command palette: no facets, a handful of rows. */
export async function quickSearch(q: Queryable, text: string, limit = 8): Promise<CatalogItem[]> {
  const p = catalogParamsSchema.parse({ q: text });
  if (!p.q) return [];
  return (await listItems(q, p, {}, limit, 0)).items;
}

/** Newest (featured first) published assets, for the home page. */
export async function latestAssets(q: Queryable, limit = 12, types?: AssetType[]): Promise<CatalogItem[]> {
  return (await listItems(q, catalogParamsSchema.parse({}), { types }, limit, 0)).items;
}

async function facets(q: Queryable, p: CatalogParams, scope: { types?: AssetType[] }): Promise<CatalogResult["facets"]> {
  // Each facet is counted with every other active filter applied, but not its own.
  const run = async (omit: string, select: string, groupBy: string) => {
    const { where, params } = buildWhere(p, scope, omit);
    return q.query<FacetOption>(`select ${select}, count(*)::int as count ${FROM} where ${where} group by ${groupBy} having count(*) > 0 order by count desc, label`, params);
  };
  const tagFacet = async (facet: "style" | "setting" | "engine") => {
    const { where, params } = buildWhere(p, scope, facet);
    return q.query<FacetOption>(
      `select t.slug as value, t.name as label, count(distinct a.id)::int as count ${FROM}
       join asset_tags at on at.asset_id = a.id join tags t on t.id = at.tag_id and t.facet = '${facet}'
       where ${where} group by t.slug, t.name order by count desc, label`,
      params,
    );
  };
  const flag = async (omit: string, cond: string) => {
    const { where, params } = buildWhere(p, scope, omit);
    const [r] = await q.query<{ n: number }>(`select count(*)::int as n ${FROM} where ${where} and ${cond}`, params);
    return r?.n ?? 0;
  };
  const formatFacet = async () => {
    const { where, params } = buildWhere(p, scope, "format");
    return q.query<FacetOption>(
      `select f as value, upper(f) as label, count(*)::int as count ${FROM}, unnest(a.formats) f where ${where} group by f order by count desc, label`,
      params,
    );
  };
  const trisFacet = async () => {
    const { where, params } = buildWhere(p, scope, "tris");
    const rows = await q.query<{ bucket: string; count: number }>(
      `select case when a.triangle_count < 1000 then 'lt-1k' when a.triangle_count < 5000 then '1k-5k'
                   when a.triangle_count < 20000 then '5k-20k' else 'gt-20k' end as bucket, count(*)::int as count
       ${FROM} where ${where} and a.triangle_count is not null group by bucket`,
      params,
    );
    const label: Record<string, string> = { "lt-1k": "Under 1k", "1k-5k": "1k–5k", "5k-20k": "5k–20k", "gt-20k": "Over 20k" };
    return Object.keys(TRI_BUCKETS)
      .map((b) => ({ value: b, label: label[b]!, count: rows.find((r) => r.bucket === b)?.count ?? 0 }))
      .filter((r) => r.count > 0);
  };

  const [type, category, style, setting, engine, format, licence, size, tris, animated, rigged, commercial] = await Promise.all([
    run("type", "a.asset_type::text as value, a.asset_type::text as label", "a.asset_type"),
    run("category", "c.slug as value, c.name as label", "c.slug, c.name").then((r) => r.filter((x) => x.value)),
    tagFacet("style"),
    tagFacet("setting"),
    tagFacet("engine"),
    formatFacet(),
    run("licence", "l.code as value, l.short_label as label", "l.code, l.short_label").then((r) => r.filter((x) => x.value)),
    run("size", "a.texture_size::text as value, a.texture_size || 'px' as label", "a.texture_size").then((r) => r.filter((x) => x.value)),
    trisFacet(),
    flag("animated", "a.is_animated"),
    flag("rigged", "a.is_rigged"),
    flag("commercial", "l.commercial_use is true"),
  ]);
  return { type, category, style, setting, engine, format, licence, size, tris, animated, rigged, commercial };
}

/* ------------------------------------------------------------------ detail */

export interface PublicFile {
  id: string;
  purpose: string;
  original_filename: string;
  format: string;
  mime: string;
  size_bytes: number;
  sha256: string;
  width: number | null;
  height: number | null;
  model_triangle_count: number | null;
  model_vertex_count: number | null;
  size_variant: number | null;
  is_primary: boolean;
  public_key: string | null;
  metadata: Record<string, unknown>;
}

export interface PublicAsset {
  asset: CatalogItem & {
    description_md: string;
    usage_notes_md: string;
    attribution_text: string | null;
    licence_source_url: string | null;
    provenance_kind: string | null;
    provenance_notes: string | null;
    version: number;
    vertex_count: number | null;
    bounds_mm: number[] | null;
    engines: string[];
    bundle_file_id: string | null;
    updated_at: Date;
    licence_label: string | null;
    licence_url: string | null;
    commercial_use: boolean | null;
    modifications: boolean | null;
    attribution_required: boolean | null;
    redistribution_allowed: boolean | null;
    share_alike: boolean | null;
    allows_download: boolean | null;
    licence_notes: string | null;
  };
  files: PublicFile[];
  tags: { slug: string; name: string; facet: string }[];
  creators: { slug: string; name: string; url: string | null; role: string }[];
  collections: { slug: string; title: string }[];
  dependencies: { slug: string; title: string; asset_type: string }[];
  related: CatalogItem[];
}

export async function getPublicAsset(q: Queryable, slug: string): Promise<PublicAsset | null> {
  const [asset] = await q.query<PublicAsset["asset"]>(
    `select a.*, c.name as category_name, c.slug as category_slug, l.short_label as licence_short, l.code as licence_code,
            l.human_label as licence_label, l.canonical_url as licence_url, l.commercial_use, l.modifications,
            l.attribution_required, l.redistribution_allowed, l.share_alike, l.allows_download, l.notes as licence_notes,
            null::text[] as tag_names
       ${FROM} where a.slug = $1 and a.status = 'published' and a.deleted_at is null`,
    [slug],
  );
  if (!asset) return null;
  const [files, tags, creators, collections, dependencies, related] = await Promise.all([
    q.query<PublicFile>(
      `select id, purpose, original_filename, format, mime, size_bytes, sha256, width, height, model_triangle_count, model_vertex_count,
              size_variant, is_primary, public_key, metadata
         from asset_files where asset_id = $1 and deleted_at is null and published and public_key is not null
        order by purpose, is_primary desc, size_variant desc nulls first, sort_order, original_filename`,
      [asset.id],
    ),
    q.query<{ slug: string; name: string; facet: string }>(
      "select t.slug, t.name, t.facet from asset_tags at join tags t on t.id = at.tag_id where at.asset_id = $1 order by t.facet, t.name",
      [asset.id],
    ),
    q.query<{ slug: string; name: string; url: string | null; role: string }>(
      "select cr.slug, cr.name, cr.url, ac.role from asset_creators ac join creators cr on cr.id = ac.creator_id where ac.asset_id = $1 order by cr.name",
      [asset.id],
    ),
    q.query<{ slug: string; title: string }>(
      "select c.slug, c.title from collection_assets ca join collections c on c.id = ca.collection_id where ca.asset_id = $1 and c.status = 'published' order by c.title",
      [asset.id],
    ),
    q.query<{ slug: string; title: string; asset_type: string }>(
      "select d.slug, d.title, d.asset_type from asset_dependencies ad join assets d on d.id = ad.depends_on_asset_id where ad.asset_id = $1 and d.status = 'published' and d.deleted_at is null",
      [asset.id],
    ),
    q.query<CatalogItem>(
      `select a.id, a.slug, a.title, a.short_description, a.asset_type, c.name as category_name, c.slug as category_slug,
              l.short_label as licence_short, l.code as licence_code, a.formats, a.triangle_count, a.texture_size, a.thumbnail_url,
              a.is_demo, a.is_animated, a.is_rigged, a.download_count, a.published_at, null::text[] as tag_names
         ${FROM}
        where a.status = 'published' and a.deleted_at is null and a.id <> $1 and a.asset_type = $2
        order by (case when a.category_id is not distinct from $3::uuid then 2 else 0 end)
               + (select count(*) from asset_tags x join asset_tags y on y.tag_id = x.tag_id where x.asset_id = a.id and y.asset_id = $1) desc,
                 a.published_at desc
        limit 8`,
      [asset.id, asset.asset_type, (asset as unknown as { category_id: string | null }).category_id],
    ),
  ]);
  return { asset, files, tags, creators, collections, dependencies, related };
}

export async function catalogCounts(q: Queryable): Promise<{ models: number; textures: number; collections: number }> {
  const [row] = await q.query<{ models: number; textures: number; collections: number }>(
    `select count(*) filter (where asset_type = 'model')::int as models,
            count(*) filter (where asset_type in ('texture', 'decal', 'skybox'))::int as textures,
            (select count(*)::int from collections where status = 'published' and deleted_at is null) as collections
       from assets where status = 'published' and deleted_at is null`,
  );
  return row ?? { models: 0, textures: 0, collections: 0 };
}
