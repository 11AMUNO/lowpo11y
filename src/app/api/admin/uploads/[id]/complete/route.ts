import { z } from "zod";
import { audit } from "@/lib/audit";
import { completeUploadSession, UploadError } from "@/lib/assets/uploads";
import { contextFor, requireStaffApi } from "@/lib/auth/server";
import { SERVICE, txFor, withDb } from "@/lib/db";
import { assertSameOrigin, HttpError, readJson, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ primary: z.boolean().optional() });

/** Verifies an uploaded file and attaches it to the asset. Staff only. */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/uploads/[id]/complete">) => {
  assertSameOrigin(request);
  const user = await requireStaffApi();
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Upload not found.", "not_found");
  const body = bodySchema.parse(await readJson(request).catch(() => ({})));
  try {
    const { file, analysis, duplicate } = await completeUploadSession(txFor(contextFor(user)), getStorage(), user.id, id, body);
    await withDb(SERVICE, (q) =>
      audit(q, user.id, duplicate ? "asset.file.duplicate" : "asset.file.add", "asset", file.asset_id, {
        fileId: file.id,
        filename: file.original_filename,
        format: file.format,
        bytes: file.size_bytes,
      }),
    );
    return Response.json({
      file: {
        id: file.id,
        purpose: file.purpose,
        filename: file.original_filename,
        format: file.format,
        sizeBytes: file.size_bytes,
        sha256: file.sha256,
        width: file.width,
        height: file.height,
        triangles: file.model_triangle_count,
        vertices: file.model_vertex_count,
      },
      duplicate,
      warnings: analysis.warnings,
    });
  } catch (e) {
    if (e instanceof UploadError) throw new HttpError(e.status, e.message, "upload_rejected");
    throw e;
  }
});
