import { findAssetsForPicker } from "@/lib/assets/admin";
import { staffRequest } from "@/lib/admin-api";
import { route } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Asset picker for the collection editor. */
export const GET = route(async (request: Request) => {
  const s = await staffRequest(request);
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 120);
  return Response.json({ items: await s.db((db) => findAssetsForPicker(db, q, 20)) });
});
