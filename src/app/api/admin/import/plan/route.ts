import { z } from "@/lib/zod";
import { applyDefaults, importDefaultsSchema, parseManifest, planFromPaths, validatePlan, type ImportEntry } from "@/lib/assets/import";
import { ASSET_TYPES } from "@/lib/assets/schemas";
import { staffRequest } from "@/lib/admin-api";
import { SERVICE, withDb } from "@/lib/db";
import { env } from "@/lib/env";
import { readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  files: z
    .array(z.object({ path: z.string().min(1).max(500), size: z.number().int().min(0), sha256: z.string().regex(/^[0-9a-f]{64}$/) }))
    .min(1)
    .max(5000),
  defaults: importDefaultsSchema.default({}),
  textureType: z.enum(ASSET_TYPES).default("texture"),
  manifest: z.object({ text: z.string().max(2_000_000), format: z.enum(["json", "csv"]) }).optional(),
});

/**
 * Dry run for a browser import: groups the selected files (or reads the
 * manifest), validates against the library and records the plan as an
 * import job. Nothing is created until the browser runs the plan.
 */
export const POST = route(async (request: Request) => {
  const s = await staffRequest(request);
  const body = bodySchema.parse(await readJson(request, 4 * 1024 * 1024));
  let entries: ImportEntry[];
  let ignored: string[] = [];
  let manifestProblems: string[] = [];
  if (body.manifest) {
    const parsed = parseManifest(body.manifest.text, body.manifest.format);
    manifestProblems = parsed.problems;
    entries = parsed.entries.map((e) => applyDefaults(e, body.defaults));
  } else {
    const plan = planFromPaths(
      body.files.map((f) => f.path),
      body.defaults,
      { textureType: body.textureType },
    );
    entries = plan.entries;
    ignored = plan.ignored;
  }
  const report = await s.db((q) => validatePlan(q, entries, body.files, env().MAX_UPLOAD_BYTES));
  const [job] = await withDb(SERVICE, (q) =>
    q.query<{ id: string }>("insert into import_jobs (actor_id, status, dry_run, manifest, report) values ($1, 'pending', true, $2::text::jsonb, $3::text::jsonb) returning id", [
      s.user.id,
      JSON.stringify({ entries: entries.length, files: body.files.length, defaults: body.defaults, manifest: body.manifest ? body.manifest.format : null }),
      JSON.stringify({ ready: report.ready, duplicates: report.duplicates, blocked: report.blocked }),
    ]),
  );
  const create = report.entries.map((v) => {
    const e = entries[v.index]!;
    return {
      title: e.title,
      slug: v.slug,
      assetType: v.type,
      shortDescription: e.shortDescription,
      descriptionMd: e.description,
      usageNotesMd: e.usageNotes,
      categoryId: v.categoryId,
      licenceId: v.licenceId,
      attributionText: e.attribution ?? null,
      licenceSourceUrl: e.sourceUrl ?? "",
      provenanceKind: e.provenance ?? null,
      provenanceNotes: e.provenanceNotes ?? null,
      engines: e.engines,
      tags: e.tags,
    };
  });
  return Response.json({ jobId: job!.id, report, create, ignored, manifestProblems });
});
