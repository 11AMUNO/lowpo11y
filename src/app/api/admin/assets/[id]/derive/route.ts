import { z } from "zod";
import { generateDerivatives } from "@/lib/assets/derive";
import { staffRequest } from "@/lib/admin-api";
import { getStorage } from "@/lib/storage";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const bodySchema = z.object({ force: z.boolean().default(false), textureVariants: z.boolean().default(true) });

/** Generates GLB from FBX, thumbnails and texture size variants. */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/assets/[id]/derive">) => {
  const s = await staffRequest(request);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Asset not found.", "not_found");
  const body = bodySchema.parse(await readJson(request).catch(() => ({})));
  try {
    const result = await generateDerivatives(s.tx, getStorage(), id, body);
    await s.log("asset.derive", "asset", id, { created: result.created.length, warnings: result.warnings.length, force: body.force });
    return Response.json(result);
  } catch (e) {
    if (e instanceof Error && e.message === "Asset not found.") throw new HttpError(404, e.message, "not_found");
    throw e;
  }
});
