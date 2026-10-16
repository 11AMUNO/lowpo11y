import { cookies } from "next/headers";
import { revokeSession, SESSION_COOKIE } from "@/lib/auth/sessions";
import { SERVICE, withDb } from "@/lib/db";
import { assertSameOrigin, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await withDb(SERVICE, (q) => revokeSession(q, token));
  jar.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
});
