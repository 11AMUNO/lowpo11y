/**
 * The daily maintenance job (GET /api/cron/daily): housekeeping the request
 * paths leave behind, and the storage budget check. Service context.
 */
import type { Queryable } from "@/lib/db";
import type { AssetStorage } from "@/lib/storage";
import { expireUploadSessions } from "@/lib/assets/uploads";

const deleted = async (q: Queryable, sql: string, params: unknown[] = []) => {
  const [r] = await q.query<{ n: string | number }>(`with d as (${sql} returning 1) select count(*) as n from d`, params);
  return Number(r?.n ?? 0);
};

export interface Housekeeping {
  rateLimitWindows: number;
  downloadDedupeKeys: number;
  expiredSessions: number;
  expiredUploads: number;
}

export async function housekeeping(q: Queryable, storage: AssetStorage, now = new Date()): Promise<Housekeeping> {
  const dayAgo = new Date(now.getTime() - 86_400_000);
  return {
    rateLimitWindows: await deleted(q, "delete from rate_limits where window_start < $1", [dayAgo]),
    downloadDedupeKeys: await deleted(q, "delete from download_dedupe where created_at < $1", [dayAgo]),
    expiredSessions: await deleted(q, "delete from user_sessions where expires_at < $1", [now]),
    expiredUploads: await expireUploadSessions(q, storage),
  };
}

export interface StorageUse {
  /** Every stored file (private originals and derivatives) plus the public copies of published ones. */
  bytes: number;
  budgetBytes: number | null;
  share: number | null;
  level: "ok" | "warning" | "over" | "unset";
}

/** An estimate from the database's records; the provider's dashboard is the authority. */
export async function storageUse(q: Queryable, budgetGb: number | undefined): Promise<StorageUse> {
  const [r] = await q.query<{ bytes: string | number }>(
    `select coalesce((select sum(size_bytes) + sum(size_bytes) filter (where public_key is not null) from asset_files where deleted_at is null), 0)
          + coalesce((select sum(file_size_bytes) * 2 from starter_projects where deleted_at is null and file_size_bytes is not null), 0) as bytes`,
  );
  const bytes = Number(r?.bytes ?? 0);
  const budgetBytes = budgetGb ? budgetGb * 1024 ** 3 : null;
  const share = budgetBytes ? bytes / budgetBytes : null;
  const level = share === null ? "unset" : share >= 1 ? "over" : share >= 0.8 ? "warning" : "ok";
  return { bytes, budgetBytes, share, level };
}

/** Posts a plain message to a Slack- or Discord-style webhook. Returns whether it was accepted. */
export async function sendAlert(webhook: string | undefined, text: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  if (!webhook) return false;
  try {
    const r = await fetchImpl(webhook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, content: text }), signal: AbortSignal.timeout(10_000) });
    return r.ok;
  } catch {
    return false;
  }
}
