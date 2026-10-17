import { staffRequest } from "@/lib/admin-api";
import { UploadError } from "@/lib/assets/uploads";
import { hitRateLimit } from "@/lib/auth/rate-limit";
import { createStarterUpload, starterUploadSchema } from "@/lib/content/files";
import { idParam, kindParam } from "@/lib/content/route-params";
import { SERVICE, withDb } from "@/lib/db";
import { env } from "@/lib/env";
import { HttpError, notFound, readJson, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Starts a signed upload of a starter project's ZIP. Staff only. */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/content/[kind]/[id]/upload">) => {
  const s = await staffRequest(request);
  const p = await ctx.params;
  if (kindParam(p.kind) !== "starter") throw notFound();
  const id = idParam(p.id, "Starter project");
  const rl = await withDb(SERVICE, (q) => hitRateLimit(q, `sign:${s.user.id}`, 300, 10 * 60));
  if (!rl.ok) throw new HttpError(429, "Too many uploads started. Wait a few minutes.", "rate_limited");
  const input = starterUploadSchema.parse(await readJson(request));
  try {
    const result = await createStarterUpload(s.tx, getStorage(), s.user.id, id, input, env().MAX_UPLOAD_BYTES);
    await s.log("upload.start", "starter", id, { filename: input.filename, size: input.size });
    return Response.json({ id: result.id, upload: result.upload }, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) throw new HttpError(e.status, e.message, "upload_rejected");
    throw e;
  }
});
