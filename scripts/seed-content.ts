/**
 * Adds LOWPO11Y's starter shaders and resource links to a database as
 * DRAFTS, for the owner to review, choose licences for and publish in the
 * admin. Works against the local database or DATABASE_URL (production).
 * Never publishes and never changes rows that already exist.
 *   pnpm db:seed-content
 */
import "./_env";
import { createDb } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { txOn } from "@/lib/db";
import { env } from "@/lib/env";
import { seedSiteContent } from "@/lib/demo/content";
import { getStorage } from "@/lib/storage";

async function main() {
  const e = env();
  const db = await createDb({ url: e.DATABASE_URL, dataDir: e.DATABASE_URL ? undefined : `${e.dataDir}/pglite`, poolMax: 1 });
  try {
    await migrate(db);
    const [admin] = await db.query<{ id: string }>("select id from users where role = 'admin' and disabled_at is null order by created_at limit 1");
    if (!admin) {
      console.error("! No admin account yet. Run `pnpm admin:create` first.");
      process.exit(1);
    }
    const r = await seedSiteContent(txOn(db, { kind: "user", userId: admin.id, role: "admin" }), getStorage(), { publish: false, siteUrl: e.NEXT_PUBLIC_APP_URL }, (s) => console.log(s));
    console.log(`> ${r.created.length} drafts added, ${r.skipped.length} already present. Review them under Admin → Shaders and Admin → Resources.`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
