/** Deletes the local data dir (PGlite database + stored files), then migrates and seeds. */
import "./_env";
import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { env } from "@/lib/env";

async function main() {
  const e = env();
  if (e.DATABASE_URL || e.STORAGE_PROVIDER !== "local") {
    console.error("! reset-local only works with the local database and storage.");
    process.exit(1);
  }
  await rm(e.dataDir, { recursive: true, force: true });
  console.log(`> removed ${e.dataDir}`);
  execFileSync("pnpm", ["exec", "tsx", "scripts/seed.ts"], { stdio: "inherit", env: process.env });
}

main();
