import { env } from "@/lib/env";

/** Whether the first-admin setup screen may be used at all. */
export function setupMode(): "token" | "local" | "disabled" {
  const e = env();
  if (e.SETUP_TOKEN) return "token";
  // Without a token, only a purely local database (PGlite, no DATABASE_URL) may be set up.
  if (!e.DATABASE_URL && e.NODE_ENV !== "production") return "local";
  return "disabled";
}
