import { randomBytes } from "node:crypto";
import { createDb, type Db } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";

export interface TestDb {
  db: Db;
  label: string;
  cleanup: () => Promise<void>;
}

/** Drivers to run integration suites against: always PGlite, plus real Postgres when TEST_DATABASE_URL is set. */
export const TEST_DRIVERS: ("pglite" | "postgres")[] = process.env.TEST_DATABASE_URL ? ["pglite", "postgres"] : ["pglite"];

/**
 * A freshly migrated, isolated database. For Postgres a throwaway database is
 * created on the server in TEST_DATABASE_URL and dropped afterwards.
 */
export async function createTestDb(driver: "pglite" | "postgres" = "pglite"): Promise<TestDb> {
  if (driver === "pglite") {
    const db = await createDb({});
    await migrate(db);
    return { db, label: "pglite", cleanup: () => db.close() };
  }
  const adminUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl) throw new Error("TEST_DATABASE_URL is not set");
  const name = `lp_test_${randomBytes(6).toString("hex")}`;
  const admin = await createDb({ url: adminUrl, poolMax: 1 });
  // TEST_DATABASE_ICU_LOCALE=en-US mimics hosts whose default collation is linguistic (CI, Supabase).
  const icu = process.env.TEST_DATABASE_ICU_LOCALE;
  await admin.exec(
    icu && /^[A-Za-z-]+$/.test(icu)
      ? `create database ${name} template template0 encoding 'UTF8' locale_provider icu icu_locale '${icu}' locale 'C.UTF-8'`
      : `create database ${name}`,
  );
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = await createDb({ url: url.toString(), poolMax: 4 });
  await migrate(db);
  return {
    db,
    label: "postgres",
    cleanup: async () => {
      await db.close();
      await admin.exec(`drop database if exists ${name} with (force)`);
      await admin.close();
    },
  };
}

/** Run a block as a given request context, mirroring withDb() in src/lib/db. */
export async function asRole<R>(
  db: Db,
  ctx: { role: "anon" } | { role: "user" | "editor" | "admin"; userId: string },
  fn: (q: Db | Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<R>,
): Promise<R> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('app.user_id', $1, true), set_config('app.role', $2, true)", [
      "userId" in ctx ? ctx.userId : "",
      ctx.role,
    ]);
    await tx.query(ctx.role === "anon" ? "set local role lp_anon" : "set local role lp_authenticated");
    return fn(tx);
  });
}

/** A Tx (see src/lib/db) bound to a test database and request context. */
export function txAs(db: Db, ctx: Parameters<typeof asRole>[1]) {
  return {
    asUser: <R>(fn: (q: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<R>) => asRole(db, ctx, fn),
    asService: <R>(fn: (q: Parameters<Parameters<Db["transaction"]>[0]>[0]) => Promise<R>) => db.transaction(fn),
  };
}
