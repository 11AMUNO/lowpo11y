import { staffRequest } from "@/lib/admin-api";
import { unpublishWithFile } from "@/lib/content/files";
import { ContentNotFoundError, deleteContent, getContent, SlugTakenError, updateContent } from "@/lib/content/repository";
import { hasFile, idParam, kindParam } from "@/lib/content/route-params";
import { CONTENT_SCHEMAS, parsePatch } from "@/lib/content/schemas";
import { HttpError, notFound, readJson, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Saves the editor's fields. Status, files and approval have their own routes. */
export const PATCH = route(async (request: Request, ctx: RouteContext<"/api/admin/content/[kind]/[id]">) => {
  const s = await staffRequest(request);
  const p = await ctx.params;
  const kind = kindParam(p.kind);
  const id = idParam(p.id);
  const patch = parsePatch(CONTENT_SCHEMAS[kind], await readJson(request));
  try {
    const row = await s.db((q) => updateContent(q, kind, id, patch));
    await s.log(`${kind}.update`, kind, id, { fields: Object.keys(patch).join(",") });
    return Response.json({ id: row.id, slug: row.slug, updatedAt: row.updated_at });
  } catch (e) {
    if (e instanceof SlugTakenError) throw new HttpError(409, e.message, "invalid_input", [{ path: "slug", message: e.message }]);
    if (e instanceof ContentNotFoundError) throw new HttpError(404, e.message, "not_found");
    throw e;
  }
});

/** Deletes an entry (admins). Public downloads are removed first; uploaded originals are kept. */
export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/admin/content/[kind]/[id]">) => {
  const s = await staffRequest(request, { adminOnly: true });
  const p = await ctx.params;
  const kind = kindParam(p.kind);
  const id = idParam(p.id);
  const row = await s.db((q) => getContent(q, kind, id));
  if (!row) throw notFound();
  if (hasFile(kind) && row.file_public_key) await unpublishWithFile(s.tx, getStorage(), kind, id, "archived");
  await s.db((q) => deleteContent(q, kind, id));
  await s.log(`${kind}.delete`, kind, id, { slug: row.slug });
  return Response.json({ ok: true });
});
