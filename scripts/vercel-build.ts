/**
 * Vercel build entry: migrate the production database first (only for
 * production deployments with DATABASE_URL), then build. A failed migration
 * fails the deploy, so the old version keeps serving.
 */
import { execFileSync } from "node:child_process";

const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: "inherit", env: process.env });

if (process.env.VERCEL_ENV === "production" && process.env.DATABASE_URL) {
  console.log("> migrating production database");
  run("pnpm", ["exec", "tsx", "scripts/migrate.ts"]);
} else {
  console.log(`> skipping migrations (VERCEL_ENV=${process.env.VERCEL_ENV ?? "unset"})`);
}
run("pnpm", ["exec", "next", "build"]);
