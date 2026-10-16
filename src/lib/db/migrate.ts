import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Db } from "./client";

export const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies supabase/migrations/*.sql in filename order, each in its own
 * transaction, recording them in lp_schema_migrations. Migration files are
 * written to be idempotent, so a database where Supabase's GitHub integration
 * already applied them is safe to run against too.
 */
export async function migrate(db: Db, dir = MIGRATIONS_DIR): Promise<MigrationResult> {
  await db.exec(`create table if not exists public.lp_schema_migrations (
    name text primary key,
    checksum text not null,
    applied_at timestamptz not null default now()
  );
  alter table public.lp_schema_migrations enable row level security;`);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const done = new Map(
    (await db.query<{ name: string; checksum: string }>("select name, checksum from public.lp_schema_migrations")).map((r) => [
      r.name,
      r.checksum,
    ]),
  );

  const result: MigrationResult = { applied: [], skipped: [] };
  for (const file of files) {
    const sql = await readFile(path.join(dir, file), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    const previous = done.get(file);
    if (previous) {
      if (previous !== checksum) {
        throw new Error(`Migration ${file} was changed after it was applied. Add a new migration instead of editing it.`);
      }
      result.skipped.push(file);
      continue;
    }
    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into public.lp_schema_migrations (name, checksum) values ($1, $2)", [file, checksum]);
    });
    result.applied.push(file);
  }
  return result;
}
