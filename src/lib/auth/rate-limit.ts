import type { Queryable } from "@/lib/db";

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Fixed-window counter stored in Postgres so limits hold across serverless
 * instances. Run with the service context.
 */
export async function hitRateLimit(q: Queryable, bucket: string, limit: number, windowSeconds: number, now = new Date()): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const [row] = await q.query<{ hits: number }>(
    `insert into rate_limits (bucket, window_start, hits) values ($1, $2, 1)
     on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
     returning hits`,
    [bucket, windowStart],
  );
  const hits = row?.hits ?? 1;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowStart.getTime() + windowSeconds * 1000 - now.getTime()) / 1000));
  return { ok: hits <= limit, remaining: Math.max(0, limit - hits), retryAfterSeconds };
}

/** Housekeeping: drop windows older than a day. */
export async function pruneRateLimits(q: Queryable, now = new Date()): Promise<void> {
  await q.query("delete from rate_limits where window_start < $1", [new Date(now.getTime() - 86_400_000)]);
}
