import { recordContentDownload, resolveContentDownload } from "@/lib/content/public";
import { PUBLIC, SERVICE, withDb } from "@/lib/db";
import { HttpError, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Counts a download, then redirects to the published ZIP. */
export const GET = route(async (_request: Request, ctx: RouteContext<"/api/starter-projects/[slug]/download">) => {
  const { slug } = await ctx.params;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) throw new HttpError(404, "This download isn't available.", "not_found");
  const file = await withDb(PUBLIC, (q) => resolveContentDownload(q, "starter", slug));
  if (!file) throw new HttpError(404, "This download isn't available.", "not_found");
  await withDb(SERVICE, (q) => recordContentDownload(q, "starter", file.id));
  // A relative Location keeps local storage URLs on the host the visitor used.
  return new Response(null, { status: 302, headers: { Location: getStorage().publicUrl(file.publicKey), "Cache-Control": "no-store" } });
});
