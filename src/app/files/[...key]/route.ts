import { HttpError, route } from "@/lib/http";
import { contentDisposition, getStorage, IMMUTABLE_CACHE } from "@/lib/storage";
import { assertSafeKey } from "@/lib/storage/keys";
import { type LocalFilesystemStorage } from "@/lib/storage/local";

export const dynamic = "force-dynamic";

const INLINE = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "model/gltf-binary"]);

/**
 * Published files. Only the public bucket is reachable here, and it only ever
 * holds copies of published files. Locally this streams from disk; on R2 the
 * custom domain normally serves these directly, and this route redirects.
 */
export const GET = route(async (request: Request, ctx: RouteContext<"/files/[...key]">) => {
  const { key: parts } = await ctx.params;
  const key = parts.join("/");
  try {
    assertSafeKey(key);
  } catch {
    throw new HttpError(404, "Not found.", "not_found");
  }
  // By provider, not instanceof: route bundles can hold separate copies of the class,
  // and the storage instance is shared through globalThis.
  const s = getStorage();
  if (s.provider !== "local") {
    const target = s.publicUrl(key);
    if (target.startsWith("http")) return Response.redirect(target, 308);
    return Response.redirect(await s.signedGetUrl("public", key, { expiresInSeconds: 300 }), 302);
  }
  const storage = s as LocalFilesystemStorage;
  const head = await storage.head("public", key).catch(() => null);
  if (!head) throw new HttpError(404, "Not found.", "not_found");
  if (request.headers.get("if-none-match") === head.etag) return new Response(null, { status: 304, headers: { ETag: head.etag! } });
  const [body, meta] = await Promise.all([storage.get("public", key), storage.meta("public", key)]);
  if (!body) throw new HttpError(404, "Not found.", "not_found");
  const type = meta?.contentType ?? "application/octet-stream";
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": type,
      "Content-Length": String(body.byteLength),
      "Cache-Control": IMMUTABLE_CACHE,
      ETag: head.etag!,
      "X-Content-Type-Options": "nosniff",
      ...(meta?.downloadName && !INLINE.has(type) ? { "Content-Disposition": contentDisposition(meta.downloadName) } : {}),
    },
  });
});
