/**
 * Boots an isolated production server for Playwright:
 * fresh data dir → migrations → demo seed → `next start`.
 * Requires a prior `pnpm build`.
 */
import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

const port = process.env.E2E_PORT ?? "3100";
const dataDir = path.resolve(".data/e2e");

async function main() {
  await rm(dataDir, { recursive: true, force: true });
  await mkdir(dataDir, { recursive: true });

  const env = { ...process.env, LOWPO11Y_DATA_DIR: dataDir, NODE_ENV: "production" as const };
  const child = spawn("pnpm", ["exec", "next", "start", "-p", port, "-H", "127.0.0.1"], {
    stdio: "inherit",
    env,
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
