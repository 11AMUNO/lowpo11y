import { z } from "zod";
import { AssetInputError, recomputeAssetFacets, setFileFlags, softDeleteFile } from "@/lib/assets/repository";
import { staffRequest } from "@/lib/admin-api";
import { getStorage } from "@/lib/storage";
import { badRequest, HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

async function ids(ctx: RouteContext<"/api/admin/assets/[id]/files/[fileId]">) {
  const { id, fileId } = await ctx.params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(fileId).success) throw new HttpError(404, "File not found.", "not_found");
  return { id, fileId };
}

const flagsSchema = z.object({ isPrimary: z.literal(true).optional(), published: z.boolean().optional(), sortOrder: z.number().int().min(0).max(10_000).optional() });

/** Marks a file primary for its purpose, or includes/excludes it from publishing. */
export const PATCH = route(async (request: Request, ctx: RouteContext<"/api/admin/assets/[id]/files/[fileId]">) => {
  const s = await staffRequest(request);
  const { id, fileId } = await ids(ctx);
  const flags = flagsSchema.parse(await readJson(request));
  try {
    await s.db(async (q) => {
      await setFileFlags(q, id, fileId, flags);
      await recomputeAssetFacets(q, id);
    });
  } catch (e) {
    if (e instanceof AssetInputError) throw badRequest(e.message);
    throw e;
  }
  await s.log("asset.file.update", "asset", id, { fileId, ...flags });
  return Response.json({ ok: true });
});

/** Removes a file. Its public copy (if any) is deleted immediately. */
export const DELETE = route(async (request: Request, ctx: RouteContext<"/api/admin/assets/[id]/files/[fileId]">) => {
  const s = await staffRequest(request);
  const { id, fileId } = await ids(ctx);
  const file = await s.db(async (q) => {
    const f = await softDeleteFile(q, id, fileId);
    if (f) await recomputeAssetFacets(q, id);
    return f;
  });
  if (!file) throw new HttpError(404, "File not found.", "not_found");
  if (file.public_key) {
    await getStorage().delete("public", file.public_key).catch(() => {});
    await s.db((q) => q.query("update asset_files set public_key = null where id = $1", [fileId]));
  }
  await s.log("asset.file.delete", "asset", id, { fileId, filename: file.original_filename });
  return Response.json({ ok: true });
});
