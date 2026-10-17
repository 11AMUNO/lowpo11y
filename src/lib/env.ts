import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { z } from "@/lib/zod";

/**
 * Server-side configuration, validated once. Nothing here is exposed to the
 * browser (only NEXT_PUBLIC_* variables are, and none of those are secrets).
 *
 * With no variables set the app runs fully locally: PGlite under
 * LOWPO11Y_DATA_DIR and filesystem storage. See .env.example and DEPLOYMENT.md.
 */
const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NEXT_PUBLIC_APP_URL: z.url().default("http://localhost:3000"),
    LOWPO11Y_DATA_DIR: z.string().default(".data/dev"),
    DATABASE_URL: z.string().optional(),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters").optional(),
    SETUP_TOKEN: z.string().min(16).optional(),
    STORAGE_PROVIDER: z.enum(["local", "r2"]).default("local"),
    R2_ACCOUNT_ID: z.string().optional(),
    R2_ACCESS_KEY_ID: z.string().optional(),
    R2_SECRET_ACCESS_KEY: z.string().optional(),
    R2_PRIVATE_BUCKET: z.string().optional(),
    R2_PUBLIC_BUCKET: z.string().optional(),
    R2_PUBLIC_BASE_URL: z.url().optional(),
    R2_ENDPOINT: z.url().optional(),
    MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(512 * 1024 * 1024),
    /** Bearer token the daily maintenance job must send (Vercel Cron sends it automatically). */
    CRON_SECRET: z.string().min(16).optional(),
    /** Storage budget in GB; the daily job warns at 80% and when it is exceeded. */
    STORAGE_BUDGET_GB: z.coerce.number().positive().optional(),
    /** Where warnings go: a Slack- or Discord-compatible incoming webhook. */
    ALERT_WEBHOOK_URL: z.url().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.STORAGE_PROVIDER === "r2") {
      for (const key of ["R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_PRIVATE_BUCKET"] as const) {
        if (!env[key]) ctx.addIssue({ code: "custom", path: [key], message: `${key} is required when STORAGE_PROVIDER=r2` });
      }
      if (!env.R2_ACCOUNT_ID && !env.R2_ENDPOINT)
        ctx.addIssue({ code: "custom", path: ["R2_ACCOUNT_ID"], message: "R2_ACCOUNT_ID or R2_ENDPOINT is required when STORAGE_PROVIDER=r2" });
      if (env.R2_PUBLIC_BUCKET && !env.R2_PUBLIC_BASE_URL)
        ctx.addIssue({ code: "custom", path: ["R2_PUBLIC_BASE_URL"], message: "R2_PUBLIC_BASE_URL is required when R2_PUBLIC_BUCKET is set" });
    }
    if (env.NODE_ENV === "production" && env.DATABASE_URL && !env.APP_SECRET) {
      ctx.addIssue({ code: "custom", path: ["APP_SECRET"], message: "APP_SECRET is required in production" });
    }
  });

export type ServerEnv = z.infer<typeof schema> & { APP_SECRET: string; dataDir: string };

let cached: ServerEnv | null = null;

/** Local-only fallback secret, generated once per data dir. Never used when APP_SECRET is set. */
function localSecret(dataDir: string): string {
  const file = path.join(dataDir, "app-secret");
  if (existsSync(file)) return readFileSync(file, "utf8").trim();
  mkdirSync(dataDir, { recursive: true });
  const secret = randomBytes(32).toString("base64url");
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function env(): ServerEnv {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid server configuration:\n${lines}\nSee .env.example and docs/DEPLOYMENT.md.`);
  }
  const dataDir = path.resolve(parsed.data.LOWPO11Y_DATA_DIR);
  cached = { ...parsed.data, dataDir, APP_SECRET: parsed.data.APP_SECRET ?? localSecret(dataDir) };
  return cached;
}

/** For tests: forget the cached environment so overrides take effect. */
export function resetEnvForTests() {
  cached = null;
}
