/**
 * Data access for shaders, starter projects, Learn (creators and tutorials)
 * and external resources. Runs under the caller's RLS context: editors work
 * on drafts, admins publish; publishing rules are enforced by database
 * triggers (migration 006) and mirrored here as a checklist for the editor.
 */
import type { Queryable } from "@/lib/db";
import type { CreatorInput, ResourceInput, ShaderInput, StarterInput, TutorialInput } from "./schemas";

export type ContentKind = "shader" | "starter" | "creator" | "tutorial" | "resource";

export const CONTENT_KINDS: ContentKind[] = ["shader", "starter", "creator", "tutorial", "resource"];

export const TABLE: Record<ContentKind, string> = {
  shader: "shader_resources",
  starter: "starter_projects",
  creator: "tutorial_creators",
  tutorial: "tutorials",
  resource: "external_resources",
};

/** Columns each kind's editor may write. Status, files and approval have their own paths. */
const WRITABLE: Record<ContentKind, readonly string[]> = {
  shader: ["slug", "title", "summary", "engine", "engine_version_min", "engine_version_max", "renderer_compatibility", "licence_id", "explanation_md", "setup_md", "limitations_md", "changelog_md", "code", "code_language", "preview_url", "source_url", "tested_at", "tested_notes", "tags", "featured"],
  starter: ["slug", "title", "summary", "engine", "engine_versions", "description_md", "included_features", "licence_id", "preview_url", "source_url", "tested_at", "tested_notes", "featured"],
  creator: ["slug", "name", "youtube_channel_url", "website_url", "description", "categories", "attribution_notes", "last_reviewed_at"],
  tutorial: ["slug", "creator_id", "title", "youtube_video_id", "external_url", "summary", "difficulty", "engine", "topic", "duration_minutes", "featured", "last_reviewed_at", "review_notes"],
  resource: ["slug", "title", "url", "category", "description", "licence_note", "link_only", "featured", "last_reviewed_at", "review_notes"],
};

/** Kinds with a status column (creators use `approved` instead). */
export const hasStatus = (k: ContentKind) => k !== "creator";
/** Kinds that soft-delete. */
const softDelete = (k: ContentKind) => k === "shader" || k === "starter";

export type ContentInput = ShaderInput | StarterInput | CreatorInput | TutorialInput | ResourceInput;
/* eslint-disable @typescript-eslint/no-explicit-any */
export type ContentRow = Record<string, any> & { id: string; slug: string };

export class ContentNotFoundError extends Error {}
export class SlugTakenError extends Error {}

const titleCol = (k: ContentKind) => (k === "creator" ? "name" : "title");

export async function listContent(q: Queryable, kind: ContentKind, opts: { search?: string; status?: string } = {}): Promise<ContentRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (softDelete(kind)) where.push("t.deleted_at is null");
  if (opts.search) {
    params.push(`%${opts.search.replace(/[%_]/g, (m) => `\\${m}`)}%`);
    where.push(`(t.${titleCol(kind)} ilike $${params.length} or t.slug ilike $${params.length})`);
  }
  if (opts.status && hasStatus(kind)) {
    params.push(opts.status);
    where.push(`t.status = $${params.length}::publish_status`);
  }
  const join = kind === "tutorial" ? "left join tutorial_creators c on c.id = t.creator_id" : "";
  const extra = kind === "tutorial" ? ", c.name as creator_name" : "";
  const rows = await q.query<ContentRow>(
    `select t.*${extra} from ${TABLE[kind]} t ${join} ${where.length ? `where ${where.join(" and ")}` : ""} order by t.updated_at desc limit 500`,
    params,
  );
  return rows;
}

export async function getContent(q: Queryable, kind: ContentKind, id: string): Promise<ContentRow | null> {
  const rows = await q.query<ContentRow>(`select * from ${TABLE[kind]} where id = $1${softDelete(kind) ? " and deleted_at is null" : ""}`, [id]);
  return rows[0] ?? null;
}

function mapErrors(e: unknown): never {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err.code === "23505") throw new SlugTakenError("That slug is already used. Choose another.");
  throw e;
}

export async function createContent(q: Queryable, kind: ContentKind, input: ContentInput): Promise<ContentRow> {
  const cols = WRITABLE[kind].filter((c) => (input as Record<string, unknown>)[c] !== undefined);
  const vals = cols.map((c) => (input as Record<string, unknown>)[c]);
  try {
    const rows = await q.query<ContentRow>(`insert into ${TABLE[kind]} (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, vals);
    return rows[0]!;
  } catch (e) {
    mapErrors(e);
  }
}

export async function updateContent(q: Queryable, kind: ContentKind, id: string, patch: Partial<ContentInput>): Promise<ContentRow> {
  const cols = WRITABLE[kind].filter((c) => (patch as Record<string, unknown>)[c] !== undefined);
  if (!cols.length) {
    const row = await getContent(q, kind, id);
    if (!row) throw new ContentNotFoundError("Not found.");
    return row;
  }
  const sets = cols.map((c, i) => `${c} = $${i + 2}`);
  try {
    const rows = await q.query<ContentRow>(
      `update ${TABLE[kind]} set ${sets.join(", ")}, updated_at = now() where id = $1${softDelete(kind) ? " and deleted_at is null" : ""} returning *`,
      [id, ...cols.map((c) => (patch as Record<string, unknown>)[c])],
    );
    if (!rows[0]) throw new ContentNotFoundError("Not found, or your role can't edit it.");
    return rows[0];
  } catch (e) {
    mapErrors(e);
  }
}

export async function setContentStatus(q: Queryable, kind: Exclude<ContentKind, "creator">, id: string, status: "draft" | "review" | "published" | "archived"): Promise<ContentRow> {
  const rows = await q.query<ContentRow>(
    `update ${TABLE[kind]} set status = $2::publish_status,
       ${kind === "resource" ? "" : "published_at = case when $2 = 'published' then coalesce(published_at, now()) else published_at end,"}
       updated_at = now()
     where id = $1${softDelete(kind) ? " and deleted_at is null" : ""} returning *`,
    [id, status],
  );
  if (!rows[0]) throw new ContentNotFoundError("Not found, or your role can't change its status.");
  return rows[0];
}

export async function setCreatorApproved(q: Queryable, id: string, approved: boolean): Promise<ContentRow> {
  const rows = await q.query<ContentRow>("update tutorial_creators set approved = $2, updated_at = now() where id = $1 returning *", [id, approved]);
  if (!rows[0]) throw new ContentNotFoundError("Creator not found.");
  return rows[0];
}

export async function deleteContent(q: Queryable, kind: ContentKind, id: string): Promise<void> {
  const gone = softDelete(kind)
    ? await q.query(`update ${TABLE[kind]} set deleted_at = now(), status = 'archived', updated_at = now() where id = $1 and deleted_at is null returning id`, [id])
    : await q.query(`delete from ${TABLE[kind]} where id = $1 returning id`, [id]);
  if (!gone.length) throw new ContentNotFoundError("Not found.");
}
