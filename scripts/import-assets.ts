/**
 * Bulk-imports a folder of models and textures as DRAFT assets.
 *
 *   pnpm import:assets <folder> --actor you@example.com [options]
 *
 * Options
 *   --dry-run                 Plan and validate only; nothing is written.
 *   --manifest <file>         JSON or CSV manifest instead of grouping by folder.
 *   --licence <code>          Licence code for every asset (e.g. cc0-1.0). Default: none.
 *   --category <slug>         Category slug (e.g. wood, props).
 *   --provenance <kind>       original | commissioned | third_party | ai_assisted | demo
 *   --provenance-notes <txt>  Who made it, with what tool or under which agreement.
 *   --tags a,b                Extra tags for every asset.
 *   --type <type>             Asset type for loose images (default texture).
 *   --report <file>           Where to write the JSON report (default .data/import-report-<time>.json).
 *   --no-derive               Skip GLB conversion, thumbnails and size variants.
 *
 * Uses DATABASE_URL and the storage settings from the environment, so the same
 * command imports into local development or production. Nothing is published
 * and rights are never confirmed by an import: review each draft in /admin.
 */
import "./_env";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { createDb } from "@/lib/db/client";
import { migrate } from "@/lib/db/migrate";
import { SERVICE, txOn, withDbOn } from "@/lib/db";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { applyDefaults, importDefaultsSchema, parseManifest, planFromPaths, runImport, validatePlan, type ImportEntry, type ImportFileInfo, type ImportRunResult } from "@/lib/assets/import";
import { ASSET_TYPES, type AssetType } from "@/lib/assets/schemas";
import { getStorage } from "@/lib/storage";

async function walk(root: string, rel = ""): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(path.join(root, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await walk(root, p)));
    else if (d.isFile()) out.push(p);
  }
  return out;
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      manifest: { type: "string" },
      licence: { type: "string" },
      category: { type: "string" },
      provenance: { type: "string" },
      "provenance-notes": { type: "string" },
      tags: { type: "string" },
      type: { type: "string" },
      actor: { type: "string" },
      report: { type: "string" },
      "no-derive": { type: "boolean", default: false },
    },
  });
  const root = positionals[0];
  if (!root) throw new Error("Give the folder to import, e.g. pnpm import:assets .data/incoming/wood --actor you@example.com");
  if (!(await stat(root)).isDirectory()) throw new Error(`${root} is not a folder.`);
  const textureType = (values.type ?? "texture") as AssetType;
  if (!ASSET_TYPES.includes(textureType)) throw new Error(`Unknown type ${values.type}.`);

  const defaults = importDefaultsSchema.parse({
    licence: values.licence,
    category: values.category,
    provenance: values.provenance,
    provenanceNotes: values["provenance-notes"],
    tags: values.tags ?? [],
  });

  const allPaths = await walk(root);
  let entries: ImportEntry[];
  let ignored: string[] = [];
  if (values.manifest) {
    const text = await readFile(values.manifest, "utf8");
    const parsed = parseManifest(text, values.manifest.endsWith(".csv") ? "csv" : "json");
    for (const p of parsed.problems) console.log(`! ${p}`);
    entries = parsed.entries.map((x) => applyDefaults(x, defaults));
  } else {
    const plan = planFromPaths(allPaths, defaults, { textureType });
    entries = plan.entries;
    ignored = plan.ignored;
  }

  const e = env();
  const db = await createDb({ url: e.DATABASE_URL, dataDir: e.DATABASE_URL ? undefined : `${e.dataDir}/pglite`, poolMax: 2 });
  try {
    await migrate(db);
    const actorEmail = values.actor ?? process.env.SEED_ADMIN_EMAIL ?? (e.DATABASE_URL ? undefined : "admin@lowpo11y.local");
    if (!actorEmail) throw new Error("Pass --actor with the email of an admin account; the import is recorded under that account.");
    const [actor] = await db.query<{ id: string; role: string }>("select id, role from users where lower(email) = lower($1) and disabled_at is null", [actorEmail]);
    if (!actor || (actor.role !== "admin" && actor.role !== "editor")) throw new Error(`No active staff account for ${actorEmail}. Create one with pnpm admin:create.`);
    const ctx = { kind: "user" as const, userId: actor.id, role: actor.role as "admin" | "editor" };

    const used = new Set(entries.flatMap((x) => x.files));
    const infos: ImportFileInfo[] = [];
    for (const p of allPaths.filter((x) => used.has(x))) {
      const bytes = await readFile(path.join(root, p));
      infos.push({ path: p, size: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
    const plan = await withDbOn(db, ctx, (q) => validatePlan(q, entries, infos, e.MAX_UPLOAD_BYTES));

    console.log(`> ${entries.length} assets planned from ${allPaths.length} files (${ignored.length} ignored)`);
    for (const v of plan.entries) {
      const mark = v.duplicateOf ? "=" : v.problems.length ? "!" : "+";
      console.log(`  ${mark} ${v.title}  [${v.type}, ${v.files.length} file${v.files.length === 1 ? "" : "s"}] -> ${v.duplicateOf ? `already imported as ${v.duplicateOf.slug}` : v.slug}`);
      for (const p of v.problems) console.log(`      ! ${p}`);
    }
    console.log(`> ready ${plan.ready} // already imported ${plan.duplicates} // blocked ${plan.blocked}`);

    const reportPath = values.report ?? path.join(e.dataDir, `import-report-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    let results: ImportRunResult[] | null = null;
    if (!values["dry-run"]) {
      const t0 = Date.now();
      results = await runImport(txOn(db, ctx), getStorage(), actor.id, entries, plan, (p) => readFile(path.join(root, p)).then((b) => new Uint8Array(b)), {
        derive: !values["no-derive"],
        log: (s) => console.log(s),
      });
      const created = results.filter((r) => r.status === "created").length;
      await withDbOn(db, SERVICE, async (q) => {
        await q.query("insert into import_jobs (actor_id, status, dry_run, manifest, report, finished_at) values ($1, 'completed', false, $2::text::jsonb, $3::text::jsonb, now())", [
          actor.id,
          JSON.stringify({ source: path.basename(path.resolve(root)), defaults, entries: entries.length }),
          JSON.stringify({ created, skipped: results!.filter((r) => r.status === "skipped").length, failed: results!.filter((r) => r.status === "failed").length }),
        ]);
        await audit(q, actor.id, "import.run", "import", null, { source: path.basename(path.resolve(root)), created, via: "cli" });
      });
      console.log(`> created ${created} drafts in ${((Date.now() - t0) / 1000).toFixed(1)} s. Review them at /admin/assets?status=draft`);
    } else {
      console.log("> dry run: nothing was written");
    }
    await mkdir(path.dirname(reportPath), { recursive: true });
    await writeFile(reportPath, JSON.stringify({ root, defaults, ignored, plan, results }, null, 2));
    console.log(`> report: ${reportPath}`);
  } finally {
    await db.close();
  }
}

main().catch((err) => {
  console.error(`! ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
