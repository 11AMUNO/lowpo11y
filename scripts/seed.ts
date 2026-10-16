/**
 * Seeds a LOCAL database with a dev admin and the procedural demo library.
 * Refuses to run against DATABASE_URL so production data is never touched.
 *   pnpm db:seed            # admin + demo content
 *   pnpm db:seed --no-demo  # admin only
 */
import "./_env";
import { createDb } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { txOn } from "@/lib/db";
import { env } from "@/lib/env";
import { createUser } from "@/lib/auth/sessions";
import { seedDemoContent } from "@/lib/demo/seed";
import { getStorage } from "@/lib/storage";

export const DEV_ADMIN = {
  email: process.env.SEED_ADMIN_EMAIL ?? "admin@lowpo11y.local",
  password: process.env.SEED_ADMIN_PASSWORD ?? "lowpo11y-local-admin",
  displayName: "Local admin",
};

async function main() {
  const e = env();
  if (e.DATABASE_URL || e.STORAGE_PROVIDER !== "local") {
    console.error("! db:seed only runs against the local embedded database and storage. Unset DATABASE_URL / STORAGE_PROVIDER.");
    process.exit(1);
  }
  const db = await createDb({ dataDir: `${e.dataDir}/pglite` });
  try {
    await migrate(db);
    let [admin] = await db.query<{ id: string }>("select id from users where lower(email) = lower($1)", [DEV_ADMIN.email]);
    if (!admin) {
      admin = await createUser(db, { ...DEV_ADMIN, role: "admin" });
      console.log(`> dev admin: ${DEV_ADMIN.email} / ${DEV_ADMIN.password}`);
    } else {
      console.log(`> dev admin exists: ${DEV_ADMIN.email}`);
    }
    if (!process.argv.includes("--no-demo")) {
      const t0 = Date.now();
      const r = await seedDemoContent(txOn(db, { kind: "user", userId: admin.id, role: "admin" }), getStorage(), admin.id, (s) => console.log(s));
      console.log(`> demo content: ${r.created.length} created, ${r.skipped.length} already present (${Date.now() - t0} ms)`);
    }
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
