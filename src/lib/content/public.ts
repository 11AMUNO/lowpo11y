/**
 * Read-only queries for the public Shaders & Code, Starter projects, Learn
 * and Resources pages. They run in the PUBLIC context, where row-level
 * security only shows published rows (and approved creators), and select
 * columns explicitly so private review notes and storage keys never reach a
 * page.
 */
import { z } from "@/lib/zod";
import type { Queryable } from "@/lib/db";
import { DIFFICULTIES, ENGINES, TOPICS } from "./schemas";

const like = (text: string) => `%${text.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

interface Licence {
  licence_code: string | null;
  licence_label: string | null;
  licence_short: string | null;
  licence_url: string | null;
  attribution_required: boolean | null;
  commercial_use: boolean | null;
}

const LICENCE_COLS = `l.code as licence_code, l.human_label as licence_label, l.short_label as licence_short, l.canonical_url as licence_url,
  l.attribution_required, l.commercial_use`;

/* --------------------------------------------------------------- shaders */

export interface ShaderCard extends Licence {
  id: string;
  slug: string;
  title: string;
  summary: string;
  engine: string;
  engine_version_min: string | null;
  engine_version_max: string | null;
  renderer_compatibility: string | null;
  code_language: string | null;
  tags: string[];
  featured: boolean;
  tested_at: Date;
  tested_notes: string | null;
  published_at: Date;
}

export interface ShaderPage extends ShaderCard {
  explanation_md: string;
  setup_md: string;
  limitations_md: string;
  changelog_md: string;
  code: string | null;
  preview_url: string | null;
  source_url: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  file_sha256: string | null;
  has_download: boolean;
  download_count: number;
  updated_at: Date;
}

const SHADER_CARD = `s.id, s.slug, s.title, s.summary, s.engine, s.engine_version_min, s.engine_version_max, s.renderer_compatibility,
  s.code_language, s.tags, s.featured, s.tested_at, s.tested_notes, s.published_at, ${LICENCE_COLS}`;

export const shaderFilterSchema = z.object({
  engine: z.enum(ENGINES.map((e) => e.id) as [string, ...string[]]).optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});

export async function listPublicShaders(q: Queryable, f: z.infer<typeof shaderFilterSchema> = {}): Promise<ShaderCard[]> {
  const where = ["s.status = 'published'", "s.deleted_at is null"];
  const params: unknown[] = [];
  if (f.engine) {
    params.push(f.engine);
    where.push(`s.engine = $${params.length}`);
  }
  if (f.q) {
    params.push(like(f.q));
    where.push(`(s.title ilike $${params.length} or s.summary ilike $${params.length} or array_to_string(s.tags, ' ') ilike $${params.length})`);
  }
  return q.query<ShaderCard>(
    `select ${SHADER_CARD} from shader_resources s left join licences l on l.id = s.licence_id
      where ${where.join(" and ")} order by s.featured desc, s.published_at desc limit 200`,
    params,
  );
}

export async function getPublicShader(q: Queryable, slug: string): Promise<ShaderPage | null> {
  const [row] = await q.query<ShaderPage>(
    `select ${SHADER_CARD}, s.explanation_md, s.setup_md, s.limitations_md, s.changelog_md, s.code, s.preview_url, s.source_url,
            s.file_name, s.file_size_bytes::float8 as file_size_bytes, s.file_sha256, (s.file_public_key is not null) as has_download, s.download_count, s.updated_at
       from shader_resources s left join licences l on l.id = s.licence_id
      where s.slug = $1 and s.status = 'published' and s.deleted_at is null`,
    [slug],
  );
  return row ?? null;
}

/* ------------------------------------------------------ starter projects */

export interface StarterCard extends Licence {
  id: string;
  slug: string;
  title: string;
  summary: string;
  engine: string;
  engine_versions: string | null;
  included_features: string[];
  featured: boolean;
  tested_at: Date;
  published_at: Date;
  file_size_bytes: number | null;
}

export interface StarterPage extends StarterCard {
  description_md: string;
  tested_notes: string | null;
  preview_url: string | null;
  source_url: string | null;
  file_name: string | null;
  file_sha256: string | null;
  has_download: boolean;
  download_count: number;
  updated_at: Date;
}

const STARTER_CARD = `p.id, p.slug, p.title, p.summary, p.engine, p.engine_versions, p.included_features, p.featured, p.tested_at, p.published_at,
  p.file_size_bytes::float8 as file_size_bytes, ${LICENCE_COLS}`;

export async function listPublicStarters(q: Queryable): Promise<StarterCard[]> {
  return q.query<StarterCard>(
    `select ${STARTER_CARD} from starter_projects p left join licences l on l.id = p.licence_id
      where p.status = 'published' and p.deleted_at is null order by p.featured desc, p.published_at desc limit 200`,
  );
}

export async function getPublicStarter(q: Queryable, slug: string): Promise<StarterPage | null> {
  const [row] = await q.query<StarterPage>(
    `select ${STARTER_CARD}, p.description_md, p.tested_notes, p.preview_url, p.source_url, p.file_name, p.file_sha256,
            (p.file_public_key is not null) as has_download, p.download_count, p.updated_at
       from starter_projects p left join licences l on l.id = p.licence_id
      where p.slug = $1 and p.status = 'published' and p.deleted_at is null`,
    [slug],
  );
  return row ?? null;
}

/* ------------------------------------------------------------- downloads */

/** The public key of a published shader or starter download, or null. */
export async function resolveContentDownload(q: Queryable, kind: "shader" | "starter", slug: string): Promise<{ id: string; publicKey: string } | null> {
  const table = kind === "shader" ? "shader_resources" : "starter_projects";
  const [row] = await q.query<{ id: string; file_public_key: string | null }>(`select id, file_public_key from ${table} where slug = $1 and status = 'published' and deleted_at is null`, [slug]);
  return row?.file_public_key ? { id: row.id, publicKey: row.file_public_key } : null;
}

/** Service context. Counts a download; nothing about the visitor is stored. */
export async function recordContentDownload(q: Queryable, kind: "shader" | "starter", id: string): Promise<void> {
  await q.query(`update ${kind === "shader" ? "shader_resources" : "starter_projects"} set download_count = download_count + 1 where id = $1`, [id]);
}

/* ----------------------------------------------------------------- Learn */

export interface CreatorCard {
  id: string;
  slug: string;
  name: string;
  description: string;
  categories: string[];
  youtube_channel_url: string | null;
  website_url: string | null;
  last_reviewed_at: Date;
  video_count: number;
}

export interface TutorialCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  youtube_video_id: string | null;
  external_url: string | null;
  difficulty: (typeof DIFFICULTIES)[number] | null;
  engine: string | null;
  topic: string | null;
  duration_minutes: number | null;
  featured: boolean;
  last_reviewed_at: Date;
  published_at: Date;
  creator_slug: string;
  creator_name: string;
}

export interface TutorialPage extends TutorialCard {
  creator_description: string;
  creator_channel_url: string | null;
  creator_website_url: string | null;
}

export const learnFilterSchema = z.object({
  topic: z.enum(TOPICS).optional().catch(undefined),
  difficulty: z.enum(DIFFICULTIES).optional().catch(undefined),
  engine: z.enum(ENGINES.map((e) => e.id) as [string, ...string[]]).optional().catch(undefined),
  featured: z.literal("1").optional().catch(undefined),
  q: z.string().trim().max(100).optional().catch(undefined),
});
export type LearnFilters = z.infer<typeof learnFilterSchema>;

const TUTORIAL_CARD = `t.id, t.slug, t.title, t.summary, t.youtube_video_id, t.external_url, t.difficulty, t.engine, t.topic, t.duration_minutes,
  t.featured, t.last_reviewed_at, t.published_at, c.slug as creator_slug, c.name as creator_name`;

// The inner join on an approved creator repeats the publishing rule, so a video never shows without its creator.
const TUTORIAL_FROM = "tutorials t join tutorial_creators c on c.id = t.creator_id and c.approved";

export async function listPublicTutorials(q: Queryable, f: LearnFilters = {}, creatorId?: string): Promise<TutorialCard[]> {
  const where = ["t.status = 'published'"];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    where.push(sql.replace("?", `$${params.length}`));
  };
  if (f.topic) add("t.topic = ?", f.topic);
  if (f.difficulty) add("t.difficulty = ?", f.difficulty);
  if (f.engine) add("t.engine = ?", f.engine);
  if (f.featured) where.push("t.featured");
  if (creatorId) add("t.creator_id = ?", creatorId);
  if (f.q) {
    params.push(like(f.q));
    where.push(`(t.title ilike $${params.length} or t.summary ilike $${params.length} or c.name ilike $${params.length})`);
  }
  return q.query<TutorialCard>(`select ${TUTORIAL_CARD} from ${TUTORIAL_FROM} where ${where.join(" and ")} order by t.featured desc, t.published_at desc limit 300`, params);
}

/** How many published videos each filter value would show, for the filter counts. */
export async function learnFacets(q: Queryable): Promise<{ topic: Record<string, number>; difficulty: Record<string, number>; engine: Record<string, number>; featured: number; total: number }> {
  const rows = await q.query<{ topic: string | null; difficulty: string | null; engine: string | null; featured: boolean }>(
    `select t.topic, t.difficulty, t.engine, t.featured from ${TUTORIAL_FROM} where t.status = 'published'`,
  );
  const count = (key: "topic" | "difficulty" | "engine") => {
    const out: Record<string, number> = {};
    for (const r of rows) if (r[key]) out[r[key]!] = (out[r[key]!] ?? 0) + 1;
    return out;
  };
  return { topic: count("topic"), difficulty: count("difficulty"), engine: count("engine"), featured: rows.filter((r) => r.featured).length, total: rows.length };
}

export async function getPublicTutorial(q: Queryable, slug: string): Promise<TutorialPage | null> {
  const [row] = await q.query<TutorialPage>(
    `select ${TUTORIAL_CARD}, c.description as creator_description, c.youtube_channel_url as creator_channel_url, c.website_url as creator_website_url
       from ${TUTORIAL_FROM} where t.slug = $1 and t.status = 'published'`,
    [slug],
  );
  return row ?? null;
}

export async function listPublicCreators(q: Queryable): Promise<CreatorCard[]> {
  return q.query<CreatorCard>(
    `select c.id, c.slug, c.name, c.description, c.categories, c.youtube_channel_url, c.website_url, c.last_reviewed_at,
            (select count(*)::int from tutorials t where t.creator_id = c.id and t.status = 'published') as video_count
       from tutorial_creators c where c.approved order by lower(c.name) limit 300`,
  );
}

export async function getPublicCreator(q: Queryable, slug: string): Promise<CreatorCard | null> {
  const [row] = await q.query<CreatorCard>(
    `select c.id, c.slug, c.name, c.description, c.categories, c.youtube_channel_url, c.website_url, c.last_reviewed_at,
            (select count(*)::int from tutorials t where t.creator_id = c.id and t.status = 'published') as video_count
       from tutorial_creators c where c.slug = $1 and c.approved`,
    [slug],
  );
  return row ?? null;
}

/* ------------------------------------------------------------- resources */

export interface ResourceCard {
  id: string;
  slug: string;
  title: string;
  url: string;
  category: string;
  description: string;
  licence_note: string | null;
  featured: boolean;
  last_reviewed_at: Date;
}

export async function listPublicResources(q: Queryable): Promise<ResourceCard[]> {
  return q.query<ResourceCard>(
    `select id, slug, title, url, category, description, licence_note, featured, last_reviewed_at
       from external_resources where status = 'published' order by featured desc, lower(title) limit 500`,
  );
}

/* ---------------------------------------------------------------- search */

export interface ContentHit {
  kind: "shader" | "starter" | "tutorial" | "creator" | "resource";
  slug: string;
  title: string;
  detail: string;
  url?: string;
}

/** Published shaders, starters, videos, creators and resources matching text, for the command palette. */
export async function searchContent(q: Queryable, text: string, limit = 3): Promise<ContentHit[]> {
  const p = like(text);
  const shaders = await q.query<{ slug: string; title: string; engine: string }>(
      "select slug, title, engine from shader_resources where status = 'published' and deleted_at is null and (title ilike $1 or summary ilike $1) order by featured desc, title limit $2",
      [p, limit],
    );
  const starters = await q.query<{ slug: string; title: string; engine: string }>(
      "select slug, title, engine from starter_projects where status = 'published' and deleted_at is null and (title ilike $1 or summary ilike $1) order by featured desc, title limit $2",
      [p, limit],
    );
  const videos = await q.query<{ slug: string; title: string; creator: string }>(
      `select t.slug, t.title, c.name as creator from ${TUTORIAL_FROM} where t.status = 'published' and (t.title ilike $1 or t.summary ilike $1) order by t.featured desc, t.title limit $2`,
      [p, limit],
    );
  const creators = await q.query<{ slug: string; name: string }>("select slug, name from tutorial_creators where approved and (name ilike $1 or description ilike $1) order by name limit $2", [p, limit]);
  const resources = await q.query<{ slug: string; title: string; url: string }>(
      "select slug, title, url from external_resources where status = 'published' and (title ilike $1 or description ilike $1) order by featured desc, title limit $2",
      [p, limit],
    );
  return [
    ...shaders.map((r) => ({ kind: "shader" as const, slug: r.slug, title: r.title, detail: r.engine })),
    ...starters.map((r) => ({ kind: "starter" as const, slug: r.slug, title: r.title, detail: r.engine })),
    ...videos.map((r) => ({ kind: "tutorial" as const, slug: r.slug, title: r.title, detail: r.creator })),
    ...creators.map((r) => ({ kind: "creator" as const, slug: r.slug, title: r.name, detail: "Creator" })),
    ...resources.map((r) => ({ kind: "resource" as const, slug: r.slug, title: r.title, detail: new URL(r.url).hostname, url: r.url })),
  ];
}

/** Everything public, for the sitemap. */
export async function contentSitemap(q: Queryable): Promise<{ path: string; updated: Date }[]> {
  const rows = await q.query<{ path: string; updated: Date }>(
    `select '/shaders/' || slug as path, updated_at as updated from shader_resources where status = 'published' and deleted_at is null
     union all select '/starter-projects/' || slug, updated_at from starter_projects where status = 'published' and deleted_at is null
     union all select '/learn/videos/' || t.slug, t.updated_at from ${TUTORIAL_FROM} where t.status = 'published'
     union all select '/learn/creators/' || slug, updated_at from tutorial_creators where approved`,
  );
  return rows;
}
