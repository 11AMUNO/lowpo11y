import { PUBLIC, withDb } from "@/lib/db";
import { route } from "@/lib/http";
import { sceneModels } from "@/lib/scene/library";
import { workshopLibrary } from "@/lib/workshop/library";

export const dynamic = "force-dynamic";

/** Published models (GLB) or textures the Scene Builder can use, newest first. */
export const GET = route(async (request: Request) => {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 100);
  const kind = url.searchParams.get("kind") === "texture" ? "texture" : "model";
  const items = await withDb(PUBLIC, async (db): Promise<unknown[]> => (kind === "model" ? sceneModels(db, q) : workshopLibrary(db, q)));
  return Response.json({ kind, items }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
});
