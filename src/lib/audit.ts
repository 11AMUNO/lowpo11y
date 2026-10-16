import type { Queryable } from "@/lib/db";

const REDACT = /(token|secret|password|key|url|signature)/i;

/** Drops values that could leak credentials or private URLs into the audit trail. */
export function redact(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (REDACT.test(k)) out[k] = "[redacted]";
    else if (typeof v === "string") out[k] = v.slice(0, 500);
    else if (v === null || typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = v.slice(0, 50).map((x) => (typeof x === "object" ? "[object]" : x));
    else out[k] = "[object]";
  }
  return out;
}

/** Records a staff action. `q` runs as that staff member (RLS requires actor = self) or as service. */
export async function audit(
  q: Queryable,
  actorId: string | null,
  action: string,
  targetType: string,
  targetId: string | null,
  details: Record<string, unknown> = {},
): Promise<void> {
  await q.query("insert into audit_log (actor_id, action, target_type, target_id, details) values ($1, $2, $3, $4, $5::text::jsonb)", [
    actorId,
    action,
    targetType,
    targetId,
    JSON.stringify(redact(details)),
  ]);
}
