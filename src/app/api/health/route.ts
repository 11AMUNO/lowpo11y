import { SERVICE, withDb } from "@/lib/db";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Liveness + dependency check for uptime monitors. Reveals no configuration values. */
export async function GET() {
  const started = Date.now();
  let db = "ok";
  try {
    await withDb(SERVICE, (q) => q.query("select 1"));
  } catch {
    db = "error";
  }
  const ok = db === "ok";
  return Response.json(
    { ok, service: "lowpo11y", db, storage: env().STORAGE_PROVIDER, ms: Date.now() - started, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
