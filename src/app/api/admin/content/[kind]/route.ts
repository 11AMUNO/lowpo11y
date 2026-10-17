import { staffRequest } from "@/lib/admin-api";
import { createContent, SlugTakenError } from "@/lib/content/repository";
import { kindParam } from "@/lib/content/route-params";
import { CONTENT_SCHEMAS } from "@/lib/content/schemas";
import { HttpError, readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Creates a draft shader, starter project, creator, video or resource. Staff only. */
export const POST = route(async (request: Request, ctx: RouteContext<"/api/admin/content/[kind]">) => {
  const s = await staffRequest(request);
  const kind = kindParam((await ctx.params).kind);
  const input = CONTENT_SCHEMAS[kind].parse(await readJson(request));
  try {
    const row = await s.db((q) => createContent(q, kind, input));
    await s.log(`${kind}.create`, kind, row.id, { slug: row.slug });
    return Response.json({ id: row.id, slug: row.slug }, { status: 201 });
  } catch (e) {
    if (e instanceof SlugTakenError) throw new HttpError(409, e.message, "invalid_input", [{ path: "slug", message: e.message }]);
    throw e;
  }
});
