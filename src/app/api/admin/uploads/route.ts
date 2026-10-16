import { audit } from "@/lib/audit";
import { createUploadSchema, createUploadSession, UploadError } from "@/lib/assets/uploads";
import { hitRateLimit } from "@/lib/auth/rate-limit";
import { contextFor, requireStaffApi } from "@/lib/auth/server";
import { SERVICE, txFor, withDb } from "@/lib/db";
import { env } from "@/lib/env";
import { assertSameOrigin, HttpError, readJson, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Starts a signed upload of one file to an asset. Staff only. */
export const POST = route(async (request: Request) => {
  assertSameOrigin(request);
  const user = await requireStaffApi();
  const rl = await withDb(SERVICE, (q) => hitRateLimit(q, `sign:${user.id}`, 300, 10 * 60));
  if (!rl.ok) throw new HttpError(429, "Too many uploads started. Wait a few minutes.", "rate_limited");
  const input = createUploadSchema.parse(await readJson(request));
  try {
    const result = await createUploadSession(txFor(contextFor(user)), getStorage(), user.id, input, env().MAX_UPLOAD_BYTES);
    await withDb(SERVICE, (q) => audit(q, user.id, "upload.start", "asset", input.assetId, { filename: input.filename, purpose: input.purpose, size: input.size }));
    return Response.json({ id: result.id, upload: result.upload }, { status: 201 });
  } catch (e) {
    if (e instanceof UploadError) throw new HttpError(e.status, e.message, "upload_rejected");
    throw e;
  }
});
