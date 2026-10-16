import { verifyToken } from "@/lib/auth/tokens";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

interface UploadToken {
  key: string;
  ct: string;
  len: number;
  exp: number;
}

/**
 * Local-storage stand-in for an R2 presigned PUT. The signed token authorises
 * writing exactly one staging object of the declared type and size; it grants
 * nothing else. The CMS action (attaching the file) still requires a session.
 */
export const PUT = route(async (request: Request) => {
  if (env().STORAGE_PROVIDER !== "local") throw new HttpError(404, "Not found.", "not_found");
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const claims = verifyToken<UploadToken>(token, env().APP_SECRET, "upload");
  if (!claims || !claims.key.startsWith("staging/")) throw new HttpError(403, "This upload link is invalid or has expired.", "forbidden");
  if ((request.headers.get("content-type") ?? "") !== claims.ct) throw new HttpError(400, "Content-Type does not match the signed upload.", "bad_request");

  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Missing request body.", "bad_request");
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > claims.len) {
      await reader.cancel();
      throw new HttpError(413, "Upload is larger than the signed size.", "too_large");
    }
    chunks.push(value);
  }
  if (received !== claims.len) throw new HttpError(400, `Expected ${claims.len} bytes, received ${received}.`, "bad_request");
  const body = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    body.set(c, off);
    off += c.byteLength;
  }
  await getStorage().put("private", claims.key, body, { contentType: claims.ct });
  return new Response(null, { status: 200 });
});
