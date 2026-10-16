import { z } from "zod";
import { unpublishAsset } from "@/lib/assets/publish";
import { AssetInputError, getAssetById, updateAsset } from "@/lib/assets/repository";
import { assetPatchSchema } from "@/lib/assets/schemas";
import { staffRequest } from "@/lib/admin-api";
import { getStorage } from "@/lib/storage";
import { badRequest, HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const id = (v: string) => {
  if (!z.uuid().safeParse(v).success) throw new HttpError(404, "Asset not found.", "not_found");
  return v;
};

/** Updates metadata, licence, provenance, attestation and tags. */
export const PATCH = route(async (request: Request, ctx: RouteContext<"/api/admin/assets/[id]">) => {
  const s = await staffRequest(request);
  const assetId = id((await ctx.params).id);
  const patch = assetPatchSchema.parse(await readJson(request));
  try {
    const asset = await s.db((q) => updateAsset(q, s.user.id, assetId, patch));
    await s.log(patch.attest === true ? "asset.attest" : patch.attest === false ? "asset.unattest" : "asset.update", "asset", assetId, {
      fields: Object.keys(patch).join(","),
    });
    return Response.json({ id: asset.id, slug: asset.slug, status: asset.status, attested: !!asset.ownership_attested_at, updatedAt: asset.updated_at });
  } catch (e) {
    if (e instanceof AssetInputError) throw badRequest(e.message);
    throw e;
  }
});

/** Removes an asset from the library (admins). Public copies go immediately; originals stay recoverable. */
export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/admin/assets/[id]">) => {
  const s = await staffRequest(request, { adminOnly: true });
  const assetId = id((await ctx.params).id);
  const asset = await s.db((q) => getAssetById(q, assetId));
  if (!asset || asset.deleted_at) throw new HttpError(404, "Asset not found.", "not_found");
  if (asset.status === "published") await unpublishAsset(s.tx, getStorage(), assetId, "archived");
  await s.db((q) => q.query("update assets set deleted_at = now() where id = $1", [assetId]));
  await s.log("asset.delete", "asset", assetId, { title: asset.title });
  return Response.json({ ok: true });
});
