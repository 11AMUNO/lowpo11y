import { PUBLIC, withDb } from "@/lib/db";
import { route } from "@/lib/http";
import { workshopLibrary } from "@/lib/workshop/library";

export const dynamic = "force-dynamic";

/** Published textures the Workshop can open, newest first, optionally filtered by title. */
export const GET = route(async (request: Request) => {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 100);
  const items = await withDb(PUBLIC, (db) => workshopLibrary(db, q));
  return Response.json({ items }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
});
