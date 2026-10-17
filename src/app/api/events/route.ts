import { usagePayload } from "@/lib/analytics/payload";
import { recordUsage } from "@/lib/analytics/record";
import { hitRateLimit } from "@/lib/auth/rate-limit";
import { SERVICE, withDb } from "@/lib/db";
import { assertSameOrigin, clientKey, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const BOT = /bot|crawl|spider|slurp|headless|lighthouse|preview|fetch|curl|wget|python|httpclient/i;
const done = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/**
 * Counts one usage event (see src/lib/analytics/events.ts). Same-origin
 * only, closed vocabulary, 240 events per address per hour; the address is
 * only used as a hashed rate-limit key that is deleted within a day.
 * Anything unexpected is dropped silently: counting must never break a page.
 */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  if (BOT.test(request.headers.get("user-agent") ?? "")) return done();
  const parsed = usagePayload.safeParse(await readJson(request, 1024).catch(() => null));
  if (!parsed.success) return done();
  await withDb(SERVICE, async (q) => {
    const rl = await hitRateLimit(q, `usage:${clientKey(request)}`, 240, 60 * 60);
    if (rl.ok) await recordUsage(q, parsed.data);
  });
  return done();
});
