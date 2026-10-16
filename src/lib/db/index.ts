import { env } from "@/lib/env";
import { createDb, type Db, type Queryable } from "./client";
import { migrate } from "./migrate";

export type { Db, Queryable, Row } from "./client";

/**
 * Who a query runs as. Public and user contexts run under row-level security;
 * `service` is reserved for server-internal bookkeeping (sessions, rate
 * limits, counters, migrations) and must never act on unvalidated input from
 * a visitor without its own checks.
 */
export type DbContext =
  | { kind: "public" }
  | { kind: "user"; userId: string; role: "user" | "editor" | "admin" }
  | { kind: "service" };

export const PUBLIC: DbContext = { kind: "public" };
export const SERVICE: DbContext = { kind: "service" };

type GlobalDb = { promise?: Promise<Db>; override?: Db };
const g = globalThis as unknown as { __lpDb?: GlobalDb };
const state: GlobalDb = (g.__lpDb ??= {});

/**
 * Process-wide database handle. Local PGlite databases are migrated
 * automatically on first use; hosted databases are migrated by `pnpm db:migrate`.
 */
export function getDb(): Promise<Db> {
  if (state.override) return Promise.resolve(state.override);
  state.promise ??= (async () => {
    const e = env();
    const db = await createDb({
      url: e.DATABASE_URL,
      dataDir: e.DATABASE_URL ? undefined : `${e.dataDir}/pglite`,
      poolMax: e.DATABASE_POOL_MAX,
    });
    if (db.kind === "pglite") await migrate(db);
    return db;
  })().catch((err) => {
    state.promise = undefined;
    throw err;
  });
  return state.promise;
}

/** Tests inject their own database (PGlite in-memory or a real Postgres). */
export function setDbForTests(db: Db | undefined) {
  state.override = db;
  state.promise = undefined;
}

/**
 * Run `fn` inside a transaction scoped to `ctx`. For public/user contexts the
 * transaction switches to an RLS-enforced role and sets the request claims
 * that policies read via app.request_user_id() / app.request_role().
 */
export async function withDb<R>(ctx: DbContext, fn: (q: Queryable) => Promise<R>): Promise<R> {
  const db = await getDb();
  return db.transaction(async (tx) => {
    if (ctx.kind !== "service") {
      await tx.query("select set_config('app.user_id', $1, true), set_config('app.role', $2, true)", [
        ctx.kind === "user" ? ctx.userId : "",
        ctx.kind === "user" ? ctx.role : "anon",
      ]);
      await tx.query(ctx.kind === "user" ? "set local role lp_authenticated" : "set local role lp_anon");
    }
    return fn(tx);
  });
}

/**
 * Runs work as the requesting user (RLS) or as the service, each call in its
 * own short transaction. Domain services take a Tx instead of nesting
 * transactions, which would deadlock single-connection PGlite and hold two
 * pooled connections on Postgres.
 */
export interface Tx {
  asUser<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
  asService<R>(fn: (q: Queryable) => Promise<R>): Promise<R>;
}

export function txFor(ctx: DbContext): Tx {
  return {
    asUser: (fn) => withDb(ctx, fn),
    asService: (fn) => withDb(SERVICE, fn),
  };
}

/** First row or null. */
export async function one<T>(q: Queryable, text: string, params?: readonly unknown[]): Promise<T | null> {
  const rows = await q.query<T>(text, params);
  return rows[0] ?? null;
}
