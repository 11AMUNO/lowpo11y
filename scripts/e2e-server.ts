/**
 * Boots an isolated production server for Playwright:
 * fresh data dir → migrations → seed (admin + demo content) → `next start`.
 * Requires a prior `pnpm build`.
 */
import { execFileSync, spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const port = process.env.E2E_PORT ?? "3100";
const dataDir = path.resolve(".data/e2e");

async function main() {
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });
  const env = {
    ...process.env,
    LOWPO11Y_DATA_DIR: dataDir,
    NEXT_PUBLIC_APP_URL: `http://127.0.0.1:${port}`,
    SEED_ADMIN_EMAIL: "e2e-admin@lowpo11y.test",
    SEED_ADMIN_PASSWORD: "e2e-admin-password-123",
    DATABASE_URL: "",
    STORAGE_PROVIDER: "local",
    // Every test browses from one address; the abuse limit would drop later tests' counts.
    USAGE_EVENTS_PER_HOUR: "1000000",
  };
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], { stdio: "inherit", env });
  const child = spawn("pnpm", ["exec", "next", "start", "-p", port, "-H", "127.0.0.1"], {
    stdio: "inherit",
    env: { ...env, NODE_ENV: "production" },
  });
  const stop = () => child.kill("SIGTERM");
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  child.on("exit", (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
