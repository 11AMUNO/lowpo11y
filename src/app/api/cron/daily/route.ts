import { timingSafeEqual } from "node:crypto";
import { SERVICE, withDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatBytes } from "@/lib/format";
import { HttpError, route } from "@/lib/http";
import { housekeeping, sendAlert, storageUse } from "@/lib/ops/maintenance";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorised(request: Request, secret: string): boolean {
  const got = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Daily maintenance, called by Vercel Cron (vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`: prunes rate-limit windows, download
 * de-duplication keys, expired sessions and abandoned uploads, and checks
 * storage against STORAGE_BUDGET_GB, posting to ALERT_WEBHOOK_URL at 80%
 * and over budget.
 */
export const GET = route(async (request: Request) => {
  const e = env();
  if (!e.CRON_SECRET) throw new HttpError(503, "Maintenance isn't configured: set CRON_SECRET.", "not_configured");
  if (!authorised(request, e.CRON_SECRET)) throw new HttpError(401, "Not authorised.", "unauthorised");
  const result = await withDb(SERVICE, async (q) => ({ housekeeping: await housekeeping(q, getStorage()), storage: await storageUse(q, e.STORAGE_BUDGET_GB) }));
  const s = result.storage;
  let alerted = false;
  if (s.level === "warning" || s.level === "over") {
    alerted = await sendAlert(
      e.ALERT_WEBHOOK_URL,
      `LOWPO11Y storage ${s.level === "over" ? "is over budget" : "is at 80% of budget"}: about ${formatBytes(s.bytes)} of ${formatBytes(s.budgetBytes!)} (${Math.round(s.share! * 100)}%). Check the R2 dashboard and remove unused files or raise STORAGE_BUDGET_GB.`,
    );
  }
  return Response.json({ ok: true, ...result, alerted }, { headers: { "Cache-Control": "no-store" } });
});
