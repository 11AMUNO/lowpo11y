import "server-only";
import { audit } from "@/lib/audit";
import { contextFor, requireStaffApi } from "@/lib/auth/server";
import type { SessionUser } from "@/lib/auth/sessions";
import { SERVICE, txFor, withDb, type DbContext, type Queryable, type Tx } from "@/lib/db";
import { assertSameOrigin, forbidden } from "@/lib/http";

export interface StaffRequest {
  user: SessionUser;
  ctx: DbContext;
  tx: Tx;
  /** Runs as the staff member under RLS. */
  db: <R>(fn: (q: Queryable) => Promise<R>) => Promise<R>;
  log: (action: string, targetType: string, targetId: string | null, details?: Record<string, unknown>) => Promise<void>;
}

/** Same-origin check + staff session for admin route handlers. */
export async function staffRequest(request: Request, opts: { adminOnly?: boolean } = {}): Promise<StaffRequest> {
  assertSameOrigin(request);
  const user = await requireStaffApi();
  if (opts.adminOnly && user.role !== "admin") throw forbidden("Only admins can do this.");
  const ctx = contextFor(user);
  return {
    user,
    ctx,
    tx: txFor(ctx),
    db: (fn) => withDb(ctx, fn),
    log: (action, targetType, targetId, details = {}) => withDb(SERVICE, (q) => audit(q, user.id, action, targetType, targetId, details)),
  };
}
