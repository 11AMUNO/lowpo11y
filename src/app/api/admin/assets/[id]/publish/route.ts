import { z } from "zod";
import { PublishError, publishAsset, unpublishAsset } from "@/lib/assets/publish";
import { assetPath } from "@/lib/assets/schemas";
import { staffRequest } from "@/lib/admin-api";
import { getStorage } from "@/lib/storage";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const assetId = (v: string) => {
  if (!z.uuid().safeParse(v).success) throw new HttpError(404, "Asset not found.", "not_found");
  return v;
};

/** Publishes (or republishes, rebuilding the ZIP). Admins only; RLS enforces it too. */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/assets/[id]/publish">) => {
  const s = await staffRequest(request, { adminOnly: true });
  const id = assetId((await ctx.params).id);
  try {
    const asset = await publishAsset(s.tx, getStorage(), id);
    await s.log("asset.publish", "asset", id, { slug: asset.slug, version: asset.version });
    return Response.json({ status: asset.status, url: assetPath(asset) });
  } catch (e) {
    if (e instanceof PublishError) throw new HttpError(409, e.message, "not_ready", e.checklist);
    throw e;
  }
});

const unpublishSchema = z.object({ status: z.enum(["draft", "archived"]).default("draft") });

/** Takes an asset offline: public copies are deleted at once. */
export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/admin/assets/[id]/publish">) => {
  const s = await staffRequest(request, { adminOnly: true });
  const id = assetId((await ctx.params).id);
  const { status } = unpublishSchema.parse(await readJson(request).catch(() => ({})));
  const asset = await unpublishAsset(s.tx, getStorage(), id, status);
  await s.log("asset.unpublish", "asset", id, { status });
  return Response.json({ status: asset.status });
});
