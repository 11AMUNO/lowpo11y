/**
 * Runs the whole site on this computer with no internet and no accounts:
 * embedded database and files under .data/offline, production build, served
 * on http://localhost:3000 (this machine only).
 *
 *   pnpm offline                      build if needed, seed, start
 *   pnpm offline --rebuild            rebuild first (after pulling changes)
 *   pnpm offline --import <folder>    also import a folder of your models/textures as drafts
 *   pnpm offline --port 4000          another port
 *   pnpm offline --lan                listen on your network too (other devices can open it)
 *
 * Sign in at /admin with admin@lowpo11y.local / lowpo11y-local-admin (change
 * it with `LOWPO11Y_DATA_DIR=.data/offline pnpm admin:create ...`).
 * Everything stays in .data/offline; delete that folder to start again.
 */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    rebuild: { type: "boolean", default: false },
    import: { type: "string" },
    port: { type: "string", default: "3000" },
    lan: { type: "boolean", default: false },
  },
});
const port = values.port!;
const dataDir = path.resolve(".data/offline");
const url = `http://localhost:${port}`;
const env = {
  ...process.env,
  LOWPO11Y_DATA_DIR: dataDir,
  NEXT_PUBLIC_APP_URL: url,
  DATABASE_URL: "",
  STORAGE_PROVIDER: "local",
  NEXT_TELEMETRY_DISABLED: "1",
};
const run = (args: string[], extra: Record<string, string> = {}) => execFileSync("pnpm", args, { stdio: "inherit", env: { ...env, ...extra } });

if (values.rebuild || !existsSync(".next/BUILD_ID")) {
  console.log("> building the site (once; takes a minute or two)…");
  run(["exec", "next", "build"], { NODE_ENV: "production" });
}
console.log("> preparing the local library…");
run(["exec", "tsx", "scripts/seed.ts"]);
if (values.import) {
  console.log(`> importing ${values.import} as drafts…`);
  run(["exec", "tsx", "scripts/import-assets.ts", values.import, "--actor", process.env.SEED_ADMIN_EMAIL ?? "admin@lowpo11y.local"]);
}
console.log(`\n> LOWPO11Y is running at ${url}  (admin: ${url}/admin)\n> Ctrl+C to stop.\n`);
const child = spawn("pnpm", ["exec", "next", "start", "-p", port, "-H", values.lan ? "0.0.0.0" : "127.0.0.1"], { stdio: "inherit", env: { ...env, NODE_ENV: "production" } });
const stop = () => child.kill("SIGTERM");
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => process.exit(code ?? 0));
