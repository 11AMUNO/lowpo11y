import { createAsset, AssetInputError } from "@/lib/assets/repository";
import { assetInputSchema } from "@/lib/assets/schemas";
import { staffRequest } from "@/lib/admin-api";
import { badRequest, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Creates a draft asset. */
export const POST = route(async (request: Request) => {
  const s = await staffRequest(request);
  const input = assetInputSchema.parse(await readJson(request));
  try {
    const asset = await s.db((q) => createAsset(q, s.user.id, input));
    await s.log("asset.create", "asset", asset.id, { title: asset.title, type: asset.asset_type });
    return Response.json({ id: asset.id, slug: asset.slug }, { status: 201 });
  } catch (e) {
    if (e instanceof AssetInputError) throw badRequest(e.message);
    throw e;
  }
});
