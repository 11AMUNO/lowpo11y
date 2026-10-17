import { staffRequest } from "@/lib/admin-api";
import { UploadError } from "@/lib/assets/uploads";
import { completeStarterUpload } from "@/lib/content/files";
import { idParam, kindParam } from "@/lib/content/route-params";
import { HttpError, notFound, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Verifies the uploaded ZIP and files it on the starter project. */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/content/[kind]/[id]/upload/[uploadId]">) => {
  const s = await staffRequest(request);
  const p = await ctx.params;
  if (kindParam(p.kind) !== "starter") throw notFound();
  const id = idParam(p.id, "Starter project");
  const uploadId = idParam(p.uploadId, "Upload");
  try {
    const row = await completeStarterUpload(s.tx, getStorage(), s.user.id, uploadId);
    if (row.id !== id) throw new HttpError(404, "Upload not found.", "not_found");
    await s.log("starter.file", "starter", id, { filename: row.file_name, bytes: Number(row.file_size_bytes), sha256: row.file_sha256 });
    return Response.json({ file: { name: row.file_name, sizeBytes: Number(row.file_size_bytes), sha256: row.file_sha256 } });
  } catch (e) {
    if (e instanceof UploadError) throw new HttpError(e.status, e.message, "upload_rejected");
    throw e;
  }
});
