import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { env } from "@/lib/env";
import { SERVICE, withDb, type DbContext } from "@/lib/db";
import { forbidden, unauthorized } from "@/lib/http";
import { isStaff, resolveSession, SESSION_COOKIE, SESSION_TTL_MS, type SessionUser } from "./sessions";

export function sessionCookieOptions(expires?: Date) {
  return {
    httpOnly: true,
    secure: env().NODE_ENV === "production" && env().NEXT_PUBLIC_APP_URL.startsWith("https://"),
    sameSite: "lax" as const,
    path: "/",
    ...(expires ? { expires } : { maxAge: SESSION_TTL_MS / 1000 }),
  };
}

/** The signed-in user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await withDb(SERVICE, (q) => resolveSession(q, token));
  if (!session) return null;
  if (session.extended) {
    try {
      jar.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
    } catch {
      // Server components cannot set cookies; the next route handler call will.
    }
  }
  return session.user;
});

/** Database context for a (possibly anonymous) user: always RLS-enforced. */
export function contextFor(user: SessionUser | null): DbContext {
  return user ? { kind: "user", userId: user.id, role: user.role } : { kind: "public" };
}

/** For admin pages: redirect to sign-in when not staff. */
export async function requireStaffPage(nextPath = "/admin"): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  if (!isStaff(user)) redirect("/auth/login?error=forbidden");
  return user;
}

/** For admin route handlers: 401/403 instead of redirects. */
export async function requireStaffApi(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw unauthorized();
  if (!isStaff(user)) throw forbidden();
  return user;
}

export async function requireAdminApi(): Promise<SessionUser> {
  const user = await requireStaffApi();
  if (user.role !== "admin") throw forbidden("Only admins can do that.");
  return user;
}
