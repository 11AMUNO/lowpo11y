import { z } from "zod";
import { DownloadError, recordDownload, resolveDownload } from "@/lib/assets/downloads";
import { PUBLIC, SERVICE, withDb } from "@/lib/db";
import { HttpError, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Counts the download, then redirects to the file's public URL. */
export const GET = route(async (request: Request, ctx: RouteContext<"/api/download/[fileId]">) => {
  const { fileId } = await ctx.params;
  if (!z.uuid().safeParse(fileId).success) throw new HttpError(404, "This file isn't available.", "not_found");
  let d;
  try {
    d = await withDb(PUBLIC, (q) => resolveDownload(q, fileId));
  } catch (e) {
    if (e instanceof DownloadError) throw new HttpError(e.status, e.message, e.status === 403 ? "licence_blocked" : "not_found");
    throw e;
  }
  const eventId = new URL(request.url).searchParams.get("e");
  await withDb(SERVICE, (q) => recordDownload(q, d, eventId));
  const target = getStorage().publicUrl(d.publicKey);
  return new Response(null, {
    status: 302,
    // A relative Location keeps local storage URLs on the host the visitor used.
    headers: { Location: target, "Cache-Control": "no-store" },
  });
});
