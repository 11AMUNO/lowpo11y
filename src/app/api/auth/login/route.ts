import { cookies } from "next/headers";
import { audit } from "@/lib/audit";
import { checkLogin, recordLoginFailure } from "@/lib/auth/login-limits";
import { loginSchema, safeNextPath } from "@/lib/auth/schemas";
import { sessionCookieOptions } from "@/lib/auth/server";
import { authenticate, createSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { sha256Hex } from "@/lib/auth/tokens";
import { SERVICE, withDb } from "@/lib/db";
import { assertSameOrigin, clientKey, HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const body = loginSchema.parse(await readJson(request));
  const ip = clientKey(request);
  const emailKey = sha256Hex(body.email.toLowerCase()).slice(0, 24);

  const limited = await withDb(SERVICE, (q) => checkLogin(q, ip, emailKey));
  if (limited) {
    throw new HttpError(429, `Too many sign-in attempts. Try again in ${Math.ceil(limited.retryAfterSeconds / 60)} minutes.`, "rate_limited");
  }

  const user = await withDb(SERVICE, (q) => authenticate(q, body.email, body.password));
  if (!user) {
    await withDb(SERVICE, (q) => recordLoginFailure(q, ip, emailKey));
    throw new HttpError(401, "Email or password is incorrect.", "invalid_credentials");
  }

  const session = await withDb(SERVICE, async (q) => {
    const s = await createSession(q, user.id, request.headers.get("user-agent"));
    await audit(q, user.id, "auth.login", "user", user.id);
    return s;
  });
  (await cookies()).set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return Response.json({ ok: true, user: { displayName: user.displayName, role: user.role }, next: safeNextPath(body.next) });
});
