import { hitRateLimit } from "@/lib/auth/rate-limit";
import { contactSchema, saveContactMessage } from "@/lib/contact";
import { SERVICE, withDb } from "@/lib/db";
import { assertSameOrigin, clientKey, HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Public contact and takedown form. Rate limited per hashed address; nothing else about the sender is kept. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const input = contactSchema.parse(await readJson(request, 32 * 1024));
  const rl = await withDb(SERVICE, (q) => hitRateLimit(q, `contact:${clientKey(request)}`, 5, 60 * 60));
  if (!rl.ok) throw new HttpError(429, "You've sent several messages in the last hour. Try again later or email us.", "rate_limited");
  // Bots that fill the hidden field get the same answer as people, but nothing is stored.
  if (input.website !== "bot") await withDb(SERVICE, (q) => saveContactMessage(q, input));
  return Response.json({ ok: true }, { status: 201 });
});
