import { z } from "zod";
import { CollectionPublishError, publishCollection, unpublishCollection } from "@/lib/assets/collections";
import { staffRequest } from "@/lib/admin-api";
import { getStorage } from "@/lib/storage";
import { HttpError, route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const collectionId = (v: string) => {
  if (!z.uuid().safeParse(v).success) throw new HttpError(404, "Collection not found.", "not_found");
  return v;
};

/** Builds the pack ZIP and publishes (or rebuilds it). Admins only. */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/collections/[id]/publish">) => {
  const s = await staffRequest(request, { adminOnly: true });
  const id = collectionId((await ctx.params).id);
  try {
    const col = await publishCollection(s.tx, getStorage(), id);
    await s.log("collection.publish", "collection", id, { bytes: col.bundle_size_bytes });
    return Response.json({ status: col.status, url: `/collections/${col.slug}` });
  } catch (e) {
    if (e instanceof CollectionPublishError) throw new HttpError(409, e.message, "not_ready");
    throw e;
  }
});

export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/admin/collections/[id]/publish">) => {
  const s = await staffRequest(request, { adminOnly: true });
  const id = collectionId((await ctx.params).id);
  await unpublishCollection(s.tx, getStorage(), id);
  await s.log("collection.unpublish", "collection", id);
  return Response.json({ status: "archived" });
});
