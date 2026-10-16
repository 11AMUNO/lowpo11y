import { collectionInputSchema, createCollection } from "@/lib/assets/collections";
import { staffRequest } from "@/lib/admin-api";
import { readJson, route } from "@/lib/http";

export const dynamic = "force-dynamic";

export const POST = route(async (request: Request) => {
  const s = await staffRequest(request);
  const input = collectionInputSchema.parse(await readJson(request));
  const col = await s.db((q) => createCollection(q, input));
  await s.log("collection.create", "collection", col.id, { title: col.title });
  return Response.json({ id: col.id, slug: col.slug }, { status: 201 });
});
