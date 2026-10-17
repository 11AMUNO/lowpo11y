import { verifyToken } from "@/lib/auth/tokens";
import { env } from "@/lib/env";
import { HttpError, route } from "@/lib/http";
import { contentDisposition, getStorage, type Bucket } from "@/lib/storage";
import { type LocalFilesystemStorage } from "@/lib/storage/local";

export const dynamic = "force-dynamic";

/** Local-storage stand-in for an R2 presigned GET of a private object. */
export const GET = route(async (request: Request) => {
  // By provider, not instanceof: route bundles can hold separate copies of the class.
  const s = getStorage();
  if (s.provider !== "local") throw new HttpError(404, "Not found.", "not_found");
  const storage = s as LocalFilesystemStorage;
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const claims = verifyToken<{ b: Bucket; key: string; dn?: string; exp: number }>(token, env().APP_SECRET, "object");
  if (!claims) throw new HttpError(403, "This link is invalid or has expired.", "forbidden");
  const body = await storage.get(claims.b, claims.key);
  if (!body) throw new HttpError(404, "Not found.", "not_found");
  const meta = await storage.meta(claims.b, claims.key);
  return new Response(body as BodyInit, {
    headers: {
      "Content-Type": meta?.contentType ?? "application/octet-stream",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...(claims.dn ? { "Content-Disposition": contentDisposition(claims.dn) } : {}),
    },
  });
});
