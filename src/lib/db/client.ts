/**
 * Minimal database interface over two drivers:
 * - PGlite (embedded WASM Postgres) when DATABASE_URL is unset — dev, tests, e2e
 * - postgres.js when DATABASE_URL is set — Supabase or any Postgres in production
 *
 * Every query is plain parameterised SQL ($1, $2 …). See docs/decisions/0002.
 *
 * Parameter conventions that behave identically on both drivers:
 * - JSON: pass JSON.stringify(value) and cast `$n::text::jsonb` (a bare
 *   `$n::jsonb` makes postgres.js encode the string a second time).
 * - Arrays: pass a JS array and cast `$n::text[]` / `$n::int[]`.
 */
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  /** Run one or more statements without parameters (migrations). */
  exec(sql: string): Promise<void>;
}

export interface Db extends Queryable {
  readonly kind: "pglite" | "postgres";
  transaction<R>(fn: (tx: Queryable) => Promise<R>): Promise<R>;
  close(): Promise<void>;
}

export interface DbOptions {
  /** Postgres connection string. When absent, PGlite is used. */
  url?: string;
  /** PGlite data directory; undefined = in-memory. */
  dataDir?: string;
  poolMax?: number;
}

export async function createDb(opts: DbOptions): Promise<Db> {
  return opts.url ? createPostgres(opts.url, opts.poolMax ?? 5) : createPglite(opts.dataDir);
}

async function createPglite(dataDir?: string): Promise<Db> {
  const [{ PGlite }, { pg_trgm }] = await Promise.all([
    import("@electric-sql/pglite"),
    import("@electric-sql/pglite/contrib/pg_trgm"),
  ]);
  const pg = await PGlite.create(dataDir ? { dataDir, extensions: { pg_trgm } } : { extensions: { pg_trgm } });
  const wrap = (q: { query: typeof pg.query; exec: typeof pg.exec }): Queryable => ({
    async query<T>(text: string, params?: readonly unknown[]) {
      const res = await q.query<T>(text, params ? [...params] : undefined);
      return res.rows;
    },
    async exec(sql: string) {
      await q.exec(sql);
    },
  });
  const base = wrap(pg);
  return {
    kind: "pglite",
    ...base,
    // PGlite runs transactions exclusively, so concurrent requests are serialised.
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
    close: () => pg.close(),
  };
}

async function createPostgres(url: string, max: number): Promise<Db> {
  const { default: postgres } = await import("postgres");
  const sql = postgres(url, {
    max,
    // Required for Supabase's transaction-mode pooler; harmless elsewhere.
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 15,
    onnotice: () => {},
    types: {
      // int8 → number (sizes and counts stay well below 2^53).
      bigint: { to: 20, from: [20], serialize: (v: number | bigint) => v.toString(), parse: (v: string) => Number(v) },
    },
  });
  type Unsafe = { unsafe: (text: string, params?: never[]) => Promise<unknown> };
  const wrap = (q: Unsafe): Queryable => ({
    async query<T>(text: string, params?: readonly unknown[]) {
      return (await q.unsafe(text, (params ?? []).map(serialiseParam) as never[])) as T[];
    },
    async exec(text: string) {
      await q.unsafe(text);
    },
  });
  return {
    kind: "postgres",
    ...wrap(sql as unknown as Unsafe),
    transaction: async (fn) => (await sql.begin((tx) => fn(wrap(tx as unknown as Unsafe)))) as never,
    close: () => sql.end({ timeout: 5 }),
  };
}

/** postgres.js sends untyped parameters as text; encode arrays as Postgres array literals. */
function serialiseParam(v: unknown): unknown {
  if (Array.isArray(v)) return toPgArray(v);
  if (v instanceof Date) return v.toISOString();
  return v;
}

export function toPgArray(values: readonly unknown[]): string {
  const items = values.map((v) => {
    if (v === null || v === undefined) return "NULL";
    const s = String(v);
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  });
  return `{${items.join(",")}}`;
}
