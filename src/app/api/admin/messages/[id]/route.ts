import { z } from "@/lib/zod";
import { staffRequest } from "@/lib/admin-api";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

const bodySchema = z.object({ status: z.enum(["new", "in_progress", "resolved"]) });

export const PATCH = route(async (request: Request, ctx: RouteContext<"/api/admin/messages/[id]">) => {
  const s = await staffRequest(request);
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new HttpError(404, "Message not found.", "not_found");
  const { status } = bodySchema.parse(await readJson(request));
  const rows = await s.db((q) =>
    q.query(
      "update contact_messages set status = $2, handled_by = case when $2 = 'new' then null else $3::uuid end, handled_at = case when $2 = 'new' then null else now() end where id = $1 returning id",
      [id, status, s.user.id],
    ),
  );
  if (!rows.length) throw new HttpError(404, "Message not found.", "not_found");
  await s.log("message.status", "contact_message", id, { status });
  return Response.json({ ok: true });
});
