import { z } from "@/lib/zod";
import { collectionInputSchema, unpublishCollection, updateCollection } from "@/lib/assets/collections";
import { staffRequest } from "@/lib/admin-api";
import { getStorage } from "@/lib/storage";
import { badRequest, HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const collectionId = (v: string) => {
  if (!z.uuid().safeParse(v).success) throw new HttpError(404, "Collection not found.", "not_found");
  return v;
};

export const PATCH = route(async (request: Request, ctx: RouteContext<"/api/admin/collections/[id]">) => {
  const s = await staffRequest(request);
  const id = collectionId((await ctx.params).id);
  const patch = collectionInputSchema.partial().parse(await readJson(request));
  try {
    const col = await s.db((q) => updateCollection(q, id, patch));
    await s.log("collection.update", "collection", id, { fields: Object.keys(patch).join(",") });
    return Response.json({ id: col.id, slug: col.slug, status: col.status });
  } catch (e) {
    if (e instanceof Error && /not found/i.test(e.message)) throw badRequest(e.message);
    throw e;
  }
});

/** Admins: removes the collection and its public pack. Member assets are untouched. */
export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/admin/collections/[id]">) => {
  const s = await staffRequest(request, { adminOnly: true });
  const id = collectionId((await ctx.params).id);
  await unpublishCollection(s.tx, getStorage(), id);
  await s.db((q) => q.query("update collections set deleted_at = now() where id = $1", [id]));
  await s.log("collection.delete", "collection", id);
  return Response.json({ ok: true });
});
