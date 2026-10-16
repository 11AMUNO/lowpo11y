import { recordCollectionDownload, resolveCollectionDownload } from "@/lib/assets/collections";
import { PUBLIC, SERVICE, withDb } from "@/lib/db";
import { HttpError, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Counts a pack download, then redirects to the prebuilt ZIP. */
export const GET = route(async (_request: Request, ctx: RouteContext<"/api/collections/[slug]/download">) => {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new HttpError(404, "This pack isn't available.", "not_found");
  const pack = await withDb(PUBLIC, (q) => resolveCollectionDownload(q, slug));
  if (!pack) throw new HttpError(404, "This pack isn't available.", "not_found");
  await withDb(SERVICE, (q) => recordCollectionDownload(q, pack.id));
  const target = getStorage().publicUrl(pack.publicKey);
  return new Response(null, {
    status: 302,
    // A relative Location keeps local storage URLs on the host the visitor used.
    headers: { Location: target, "Cache-Control": "no-store" },
  });
});
