import { z } from "@/lib/zod";
import { contextFor, requireStaffApi } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { HttpError, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Staff preview of any stored file, published or not, via a short-lived signed URL. */
export const GET = route(async (request: Request, ctx: RouteContext<"/api/admin/files/[fileId]">) => {
  const user = await requireStaffApi();
  const { fileId } = await ctx.params;
  if (!z.uuid().safeParse(fileId).success) throw new HttpError(404, "File not found.", "not_found");
  const [file] = await withDb(contextFor(user), (q) =>
    q.query<{ storage_key: string; original_filename: string }>("select storage_key, original_filename from asset_files where id = $1 and deleted_at is null", [fileId]),
  );
  if (!file) throw new HttpError(404, "File not found.", "not_found");
  const download = new URL(request.url).searchParams.has("download");
  const url = await getStorage().signedGetUrl("private", file.storage_key, { expiresInSeconds: 300, downloadName: download ? file.original_filename : undefined });
  return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "private, no-store" } });
});
