/**
 * Seeds a LOCAL database with a dev admin (and, from M03, demo content).
 * Refuses to run against DATABASE_URL so production data is never touched.
 *   pnpm db:seed
 */
import "./_env";
import { createDb } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { env } from "@/lib/env";
import { createUser } from "@/lib/auth/sessions";

export const DEV_ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@lowpo11y.local",
  password: process.env.SEED_ADMIN_PASSWORD ?? "lowpo11y-local-admin",
  displayName: "Local admin",
};

async function main() {
  const e = env();
  if (e.DATABASE_URL) {
    console.error("! db:seed only runs against the local embedded database. Unset DATABASE_URL to seed locally.");
    process.exit(1);
  }
  const db = await createDb({ dataDir: `${e.dataDir}/pglite` });
  try {
    await migrate(db);
    const [existing] = await db.query("select 1 from users where lower(email) = lower($1)", [DEV_ADMIN.email]);
    if (!existing) {
      await createUser(db, { ...DEV_ADMIN, role: "admin" });
      console.log(`> dev admin: ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`);
    } else {
      console.log(`> dev admin exists: ${DEV_ADMIN.email}`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
