import { z } from "zod";
import { staffRequest } from "@/lib/admin-api";
import { SERVICE, withDb } from "@/lib/db";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  status: z.enum(["completed", "failed", "cancelled"]),
  results: z
    .array(z.object({ title: z.string().max(200), status: z.enum(["created", "skipped", "failed"]), slug: z.string().max(100).optional(), message: z.string().max(2000).optional() }))
    .max(5000),
});

/** Records how a browser-run import ended. */
export const PATCH = route(async (request: Request, ctx: RouteContext<"/api/admin/import/jobs/[id]">) => {
  const s = await staffRequest(request);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Import not found.", "not_found");
  const body = bodySchema.parse(await readJson(request, 2 * 1024 * 1024));
  const created = body.results.filter((r) => r.status === "created").length;
  const rows = await withDb(SERVICE, (q) =>
    q.query(
      "update import_jobs set status = $3, dry_run = false, report = report || $4::text::jsonb, finished_at = now() where id = $1 and actor_id = $2 returning id",
      [id, s.user.id, body.status, JSON.stringify({ created, results: body.results })],
    ),
  );
  if (!rows.length) throw new HttpError(404, "Import not found.", "not_found");
  await s.log("import.run", "import", id, { created, status: body.status, via: "admin" });
  return Response.json({ ok: true });
});
