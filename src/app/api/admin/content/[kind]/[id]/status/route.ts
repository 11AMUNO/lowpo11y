import { staffRequest } from "@/lib/admin-api";
import { UploadError } from "@/lib/assets/uploads";
import { publishWithFile, unpublishWithFile } from "@/lib/content/files";
import { ContentNotFoundError, getContent, setContentStatus, setCreatorApproved } from "@/lib/content/repository";
import { hasFile, idParam, kindParam } from "@/lib/content/route-params";
import { creatorApprovalSchema, statusChangeSchema } from "@/lib/content/schemas";
import { env } from "@/lib/env";
import { forbidden, HttpError, notFound, readJson, route } from "@/lib/http";
import { getStorage } from "@/lib/storage";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Moves an entry between draft, review, published and archived, or approves
 * a creator. Editors may move unpublished work between draft and review;
 * publishing, archiving, unpublishing and approval are for admins. The
 * database checks every publishing rule again.
 */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/content/[kind]/[id]/status">) => {
  const s = await staffRequest(request);
  const p = await ctx.params;
  const kind = kindParam(p.kind);
  const id = idParam(p.id);
  const body = await readJson(request);
  const isAdmin = s.user.role === "admin";

  try {
    if (kind === "creator") {
      const { approved } = creatorApprovalSchema.parse(body);
      if (!isAdmin) throw forbidden("Only admins approve creators.");
      const row = await s.db((q) => setCreatorApproved(q, id, approved));
      await s.log(approved ? "creator.approve" : "creator.unapprove", kind, id, { slug: row.slug });
      return Response.json({ approved: row.approved });
    }

    const { status } = statusChangeSchema.parse(body);
    const current = await s.db((q) => getContent(q, kind, id));
    if (!current) throw notFound();
    if (!isAdmin && (status === "published" || status === "archived" || current.status === "published" || current.status === "archived")) {
      throw forbidden("Only admins publish, archive or unpublish. Send it for review instead.");
    }
    let row;
    if (hasFile(kind) && status === "published") row = await publishWithFile(s.tx, getStorage(), kind, id, env().NEXT_PUBLIC_APP_URL);
    else if (hasFile(kind) && current.status === "published") row = await unpublishWithFile(s.tx, getStorage(), kind, id, status as Exclude<typeof status, "published">);
    else row = await s.db((q) => setContentStatus(q, kind, id, status));
    await s.log(status === "published" ? `${kind}.publish` : current.status === "published" ? `${kind}.unpublish` : `${kind}.status`, kind, id, { slug: row.slug, from: current.status, to: status });
    return Response.json({ status: row.status, publishedAt: row.published_at ?? null });
  } catch (e) {
    if (e instanceof ContentNotFoundError) throw new HttpError(404, e.message, "not_found");
    if (e instanceof UploadError) throw new HttpError(e.status, e.message, "not_found");
    throw e;
  }
});
