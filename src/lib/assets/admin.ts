/**
 * Admin-side queries. Run under the signed-in staff member's RLS context, so
 * editors and admins see exactly what their role allows.
 */
import { z } from "@/lib/zod";
import type { Queryable } from "@/lib/db";
import { ASSET_TYPES, type AssetType } from "./schemas";

export const ADMIN_PAGE_SIZE = 50;
export const ASSET_STATUSES = ["draft", "review", "published", "archived"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const adminListSchema = z.object({
  q: z.string().trim().max(120).optional().catch(undefined),
  status: z.enum(ASSET_STATUSES).optional().catch(undefined),
  type: z.enum(ASSET_TYPES).optional().catch(undefined),
  problem: z.enum(["licence", "files"]).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});
export type AdminListParams = z.infer<typeof adminListSchema>;

export interface AdminAssetItem {
  id: string;
  slug: string;
  title: string;
  asset_type: AssetType;
  status: AssetStatus;
  is_demo: boolean;
  thumbnail_url: string | null;
  /** Thumbnail file for drafts, which have no public thumbnail yet. */
  thumb_file_id: string | null;
  licence_short: string | null;
  attested: boolean;
  file_count: number;
  formats: string[];
  updated_at: Date;
}

export async function listAdminAssets(q: Queryable, p: AdminListParams): Promise<{ items: AdminAssetItem[]; total: number; pageCount: number }> {
  const conds = ["a.deleted_at is null"];
  const params: unknown[] = [];
  const add = (sql: string, v: unknown) => {
    params.push(v);
    conds.push(sql.replace("?", `$${params.length}`));
  };
  if (p.q) add("(a.title ilike ? or a.slug ilike $" + (params.length + 1) + ")", `%${p.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
  if (p.status) add("a.status = ?::publish_status", p.status);
  if (p.type) add("a.asset_type = ?::asset_type", p.type);
  if (p.problem === "licence") conds.push("(a.licence_id is null or a.ownership_attested_at is null or l.code = 'unknown')");
  if (p.problem === "files") conds.push("not exists (select 1 from asset_files f where f.asset_id = a.id and f.deleted_at is null and f.purpose = 'delivery')");
  const where = conds.join(" and ");
  const from = "from assets a left join licences l on l.id = a.licence_id";
  const [items, [count]] = await Promise.all([
    q.query<AdminAssetItem>(
      `select a.id, a.slug, a.title, a.asset_type, a.status, a.is_demo, a.thumbnail_url, l.short_label as licence_short,
              a.ownership_attested_at is not null as attested, a.formats, a.updated_at,
              (select f.id from asset_files f where f.asset_id = a.id and f.deleted_at is null and f.purpose = 'thumbnail' order by f.is_primary desc, f.created_at limit 1) as thumb_file_id,
              (select count(*)::int from asset_files f where f.asset_id = a.id and f.deleted_at is null) as file_count
         ${from} where ${where} order by a.updated_at desc, a.id limit ${ADMIN_PAGE_SIZE} offset ${(p.page - 1) * ADMIN_PAGE_SIZE}`,
      params,
    ),
    q.query<{ n: number }>(`select count(*)::int as n ${from} where ${where}`, params),
  ]);
  const total = count?.n ?? 0;
  return { items, total, pageCount: Math.max(1, Math.ceil(total / ADMIN_PAGE_SIZE)) };
}

export interface LicenceOption {
  id: string;
  code: string;
  human_label: string;
  short_label: string;
  attribution_required: boolean | null;
  allows_download: boolean;
}

export async function licenceOptions(q: Queryable): Promise<LicenceOption[]> {
  return q.query<LicenceOption>("select id, code, human_label, short_label, attribution_required, allows_download from licences order by sort_order, human_label");
}

export async function categoryOptions(q: Queryable): Promise<{ id: string; slug: string; name: string; scope: string }[]> {
  return q.query("select id, slug, name, scope from categories order by sort_order, name");
}

export interface AuditEntry {
  id: string;
  action: string;
  target_type: string;
  target_id: string | null;
  details: Record<string, unknown>;
  created_at: Date;
  actor_name: string | null;
}

/** Audit rows are admin-only under RLS; editors get an empty list. */
export async function auditFor(q: Queryable, targetType: string, targetId: string, limit = 50): Promise<AuditEntry[]> {
  return q.query<AuditEntry>(
    `select l.id, l.action, l.target_type, l.target_id, l.details, l.created_at, u.display_name as actor_name
       from audit_log l left join user_names u on u.id = l.actor_id
      where l.target_type = $1 and l.target_id = $2 order by l.created_at desc limit ${Math.floor(limit)}`,
    [targetType, targetId],
  );
}

export const auditListSchema = z.object({
  action: z
    .string()
    .trim()
    .regex(/^[a-z.]{1,40}$/)
    .optional()
    .catch(undefined),
  page: z.coerce.number().int().min(1).max(1000).default(1).catch(1),
});

export async function listAudit(q: Queryable, p: z.infer<typeof auditListSchema>): Promise<{ items: AuditEntry[]; pageCount: number }> {
  const params: unknown[] = [];
  let where = "true";
  if (p.action) {
    params.push(`${p.action}%`);
    where = "l.action like $1";
  }
  const [items, [count]] = await Promise.all([
    q.query<AuditEntry>(
      `select l.id, l.action, l.target_type, l.target_id, l.details, l.created_at, u.display_name as actor_name
         from audit_log l left join user_names u on u.id = l.actor_id where ${where}
        order by l.created_at desc, l.id limit ${ADMIN_PAGE_SIZE} offset ${(p.page - 1) * ADMIN_PAGE_SIZE}`,
      params,
    ),
    q.query<{ n: number }>(`select count(*)::int as n from audit_log l where ${where}`, params),
  ]);
  return { items, pageCount: Math.max(1, Math.ceil((count?.n ?? 0) / ADMIN_PAGE_SIZE)) };
}

export interface AdminCollectionItem {
  id: string;
  slug: string;
  title: string;
  status: AssetStatus;
  featured: boolean;
  asset_count: number;
  bundle_built_at: Date | null;
  updated_at: Date;
}

export async function listAdminCollections(q: Queryable): Promise<AdminCollectionItem[]> {
  return q.query<AdminCollectionItem>(
    `select c.id, c.slug, c.title, c.status, c.featured, c.bundle_built_at, c.updated_at,
            (select count(*)::int from collection_assets ca where ca.collection_id = c.id) as asset_count
       from collections c where c.deleted_at is null order by c.updated_at desc`,
  );
}

export interface CollectionMember {
  id: string;
  slug: string;
  title: string;
  asset_type: AssetType;
  status: AssetStatus;
  thumbnail_url: string | null;
  licence_short: string | null;
}

export async function collectionMembers(q: Queryable, collectionId: string): Promise<CollectionMember[]> {
  return q.query<CollectionMember>(
    `select a.id, a.slug, a.title, a.asset_type, a.status, a.thumbnail_url, l.short_label as licence_short
       from collection_assets ca join assets a on a.id = ca.asset_id left join licences l on l.id = a.licence_id
      where ca.collection_id = $1 and a.deleted_at is null order by ca.position`,
    [collectionId],
  );
}

/** Asset picker for collections: matching assets by title, newest first. */
export async function findAssetsForPicker(q: Queryable, text: string, limit = 20): Promise<CollectionMember[]> {
  const like = `%${text.trim().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
  return q.query<CollectionMember>(
    `select a.id, a.slug, a.title, a.asset_type, a.status, a.thumbnail_url, l.short_label as licence_short
       from assets a left join licences l on l.id = a.licence_id
      where a.deleted_at is null and (a.title ilike $1 or a.slug ilike $1) order by a.status = 'published' desc, a.updated_at desc limit ${Math.floor(limit)}`,
    [like],
  );
}

export interface ContactMessage {
  id: string;
  kind: "general" | "takedown" | "correction" | "suggestion";
  name: string;
  email: string;
  subject: string;
  message: string;
  page_url: string | null;
  status: "new" | "in_progress" | "resolved";
  handled_at: Date | null;
  created_at: Date;
}

export async function listMessages(q: Queryable, status?: ContactMessage["status"]): Promise<ContactMessage[]> {
  return q.query<ContactMessage>(
    `select id, kind, name, email, subject, message, page_url, status, handled_at, created_at from contact_messages
      where ($1::text is null or status = $1) order by (status = 'resolved'), created_at desc limit 200`,
    [status ?? null],
  );
}
