import type { Queryable } from "@/lib/db";
import { dummyHash, hashPassword, needsRehash, passwordProblems, verifyPassword } from "./password";
import { randomToken, sha256Hex } from "./tokens";

export const SESSION_COOKIE = "lp_session";
export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
/** However active a session is, it ends this long after sign-in. */
export const SESSION_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
const EXTEND_WHEN_REMAINING_MS = 7 * 24 * 60 * 60 * 1000;

export type Role = "user" | "editor" | "admin";

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  password_hash: string;
  disabled_at: Date | null;
}

const toUser = (r: Pick<UserRow, "id" | "email" | "display_name" | "role">): SessionUser => ({
  id: r.id,
  email: r.email,
  displayName: r.display_name,
  role: r.role,
});

export class AuthInputError extends Error {}

/** Service context only. */
export async function createUser(
  q: Queryable,
  input: { email: string; password: string; displayName: string; role: Role },
): Promise<SessionUser> {
  const email = input.email.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthInputError("Enter a valid email address.");
  const problems = passwordProblems(input.password);
  if (problems.length) throw new AuthInputError(problems.join(" "));
  const existing = await q.query("select 1 from users where lower(email) = lower($1)", [email]);
  if (existing.length) throw new AuthInputError("An account with that email already exists.");
  const [row] = await q.query<UserRow>(
    `insert into users (email, password_hash, display_name, role) values ($1, $2, $3, $4)
     returning id, email, display_name, role`,
    [email, await hashPassword(input.password), input.displayName.trim() || email.split("@")[0], input.role],
  );
  return toUser(row!);
}

/** Verifies credentials in constant time regardless of whether the email exists. */
export async function authenticate(q: Queryable, email: string, password: string): Promise<SessionUser | null> {
  const [row] = await q.query<UserRow>(
    "select id, email, display_name, role, password_hash, disabled_at from users where lower(email) = lower($1)",
    [email.trim()],
  );
  const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash()));
  if (!row || !ok || row.disabled_at) return null;
  await q.query("update users set last_login_at = now() where id = $1", [row.id]);
  if (needsRehash(row.password_hash)) await q.query("update users set password_hash = $2 where id = $1", [row.id, await hashPassword(password)]);
  return toUser(row);
}

export async function createSession(q: Queryable, userId: string, userAgent?: string | null, now = new Date()) {
  const token = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await q.query("insert into user_sessions (user_id, token_hash, user_agent, expires_at) values ($1, $2, $3, $4)", [
    userId,
    sha256Hex(token),
    userAgent?.slice(0, 300) ?? null,
    expiresAt,
  ]);
  return { token, expiresAt };
}

export interface ResolvedSession {
  user: SessionUser;
  sessionId: string;
  expiresAt: Date;
  /** True when the expiry was extended and the cookie should be re-issued. */
  extended: boolean;
}

export async function resolveSession(q: Queryable, token: string | undefined, now = new Date()): Promise<ResolvedSession | null> {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [row] = await q.query<UserRow & { session_id: string; expires_at: Date; created_at: Date }>(
    `select s.id as session_id, s.expires_at, s.created_at, u.id, u.email, u.display_name, u.role, u.password_hash, u.disabled_at
       from user_sessions s join users u on u.id = s.user_id
      where s.token_hash = $1`,
    [sha256Hex(token)],
  );
  if (!row) return null;
  const endsAt = new Date(row.created_at).getTime() + SESSION_MAX_AGE_MS;
  if (row.disabled_at || new Date(row.expires_at).getTime() <= now.getTime() || endsAt <= now.getTime()) {
    await q.query("delete from user_sessions where id = $1", [row.session_id]);
    return null;
  }
  let expiresAt = new Date(row.expires_at);
  let extended = false;
  if (expiresAt.getTime() - now.getTime() < EXTEND_WHEN_REMAINING_MS && expiresAt.getTime() < endsAt) {
    expiresAt = new Date(Math.min(now.getTime() + SESSION_TTL_MS, endsAt));
    extended = true;
    await q.query("update user_sessions set expires_at = $2, last_seen_at = now() where id = $1", [row.session_id, expiresAt]);
  }
  return { user: toUser(row), sessionId: row.session_id, expiresAt, extended };
}

export async function revokeSession(q: Queryable, token: string): Promise<void> {
  await q.query("delete from user_sessions where token_hash = $1", [sha256Hex(token)]);
}

export async function revokeAllSessions(q: Queryable, userId: string): Promise<void> {
  await q.query("delete from user_sessions where user_id = $1", [userId]);
}

export async function setPassword(q: Queryable, userId: string, password: string): Promise<void> {
  const problems = passwordProblems(password);
  if (problems.length) throw new AuthInputError(problems.join(" "));
  await q.query("update users set password_hash = $2 where id = $1", [userId, await hashPassword(password)]);
  await revokeAllSessions(q, userId);
}

/**
 * First-time setup is open only while no account exists at all: disabling
 * the only admin doesn't reopen it. Takes a transaction-scoped lock so two
 * simultaneous setup requests can't both create an admin.
 */
export async function setupOpen(q: Queryable, lock = false): Promise<boolean> {
  if (lock) await q.query("select pg_advisory_xact_lock(hashtext('lowpo11y:first-admin-setup'))");
  const [row] = await q.query<{ any: boolean }>("select exists (select 1 from users) as any");
  return !row?.any;
}

export function isStaff(user: SessionUser | null | undefined): user is SessionUser {
  return !!user && (user.role === "editor" || user.role === "admin");
}
