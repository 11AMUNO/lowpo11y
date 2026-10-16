/**
 * Applies supabase/migrations to the configured database.
 *   pnpm db:migrate                      # DATABASE_URL, or local PGlite under LOWPO11Y_DATA_DIR
 * On Vercel this runs before production builds (see `vercel-build`).
 */
import "./_env";
import { createDb } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { env } from "@/lib/env";

async function main() {
  const e = env();
  const db = await createDb({ url: e.DATABASE_URL, dataDir: e.DATABASE_URL ? undefined : `${e.dataDir}/pglite`, poolMax: 1 });
  try {
    const { applied, skipped } = await migrate(db);
    console.log(`> database: ${db.kind}${e.DATABASE_URL ? "" : ` (${e.dataDir}/pglite)`}`);
    for (const f of applied) console.log(`  applied  ${f}`);
    console.log(`> ${applied.length} applied, ${skipped.length} already up to date`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
