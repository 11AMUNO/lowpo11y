import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { audit } from "@/lib/audit";
import { hitRateLimit } from "@/lib/auth/rate-limit";
import { setupSchema } from "@/lib/auth/schemas";
import { sessionCookieOptions } from "@/lib/auth/server";
import { setupMode } from "@/lib/auth/setup";
import { adminCount, AuthInputError, createSession, createUser, SESSION_COOKIE } from "@/lib/auth/sessions";
import { SERVICE, withDb } from "@/lib/db";
import { env } from "@/lib/env";
import { assertSameOrigin, badRequest, clientKey, forbidden, HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

function tokenMatches(given: string | undefined, expected: string) {
  const a = Buffer.from(given ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Creates the first admin account. Refuses once any admin exists. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const body = setupSchema.parse(await readJson(request));
  const rl = await withDb(SERVICE, (q) => hitRateLimit(q, `setup:${clientKey(request)}`, 5, 15 * 60));
  if (!rl.ok) throw new HttpError(429, "Too many attempts. Try again later.", "rate_limited");

  const mode = setupMode();
  if (mode === "disabled") throw forbidden("Set the SETUP_TOKEN environment variable to enable first-time setup.");
  if (mode === "token" && !tokenMatches(body.token, env().SETUP_TOKEN!)) throw forbidden("The setup token is incorrect.");

  const result = await withDb(SERVICE, async (q) => {
    if ((await adminCount(q)) > 0) throw forbidden("Setup is already complete. Sign in instead.");
    try {
      const user = await createUser(q, { email: body.email, password: body.password, displayName: body.displayName, role: "admin" });
      const session = await createSession(q, user.id, request.headers.get("user-agent"));
      await audit(q, user.id, "auth.setup", "user", user.id);
      return { user, session };
    } catch (e) {
      if (e instanceof AuthInputError) throw badRequest(e.message);
      throw e;
    }
  });
  (await cookies()).set(SESSION_COOKIE, result.session.token, sessionCookieOptions(result.session.expiresAt));
  return Response.json({ ok: true });
});
