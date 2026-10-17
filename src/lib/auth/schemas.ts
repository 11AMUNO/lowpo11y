import { z } from "@/lib/zod";

export const loginSchema = z.object({
  email: z.string().trim().min(3).max(320),
  password: z.string().min(1).max(256),
  next: z.string().max(500).optional(),
});

export const setupSchema = z.object({
  token: z.string().max(200).optional(),
  email: z.string().trim().min(3).max(320),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(1).max(256),
});

const BASE = "https://lowpo11y.invalid";

/**
 * Only same-site paths are allowed as post-login destinations (no open
 * redirects). Browsers drop tabs and newlines inside URLs and read "\" as
 * "/", so "/\t/evil.example" would leave the site: control characters and
 * backslashes are refused, and the path must still resolve to this origin.
 */
export function safeNextPath(next: string | undefined | null, fallback = "/admin"): string {
  if (!next || next.length > 500 || !next.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  try {
    const u = new URL(next, BASE);
    return u.origin === BASE ? u.pathname + u.search + u.hash : fallback;
  } catch {
    return fallback;
  }
}
