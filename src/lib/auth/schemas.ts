import { z } from "zod";

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

/** Only same-site relative paths are allowed as post-login destinations (no open redirects). */
export function safeNextPath(next: string | undefined | null, fallback = "/admin"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /[\r\n]/.test(next)) return fallback;
  return next;
}
