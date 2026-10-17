import { quickSearch } from "@/lib/assets/catalog";
import { searchCollections } from "@/lib/assets/collections";
import { ASSET_TYPE_LABEL, assetPath } from "@/lib/assets/schemas";
import { publicPath } from "@/lib/content/paths";
import { searchContent } from "@/lib/content/public";
import { engineLabel } from "@/lib/content/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { formatCount } from "@/lib/format";
import type { SearchResult } from "@/lib/search/types";

export const dynamic = "force-dynamic";

/** Catalogue search for the command palette. Static pages and tools are matched client-side. */
export async function GET(request: Request) {
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return Response.json({ results: [] });
  const [assets, collections, content] = await withDb(PUBLIC, async (db) => [await quickSearch(db, q, 8), await searchCollections(db, q, 3), await searchContent(db, q, 3)] as const);
  const results: SearchResult[] = [
    ...assets.map((a) => ({
      id: `asset:${a.id}`,
      kind: (a.asset_type === "texture" ? "texture" : "asset") as SearchResult["kind"],
      title: a.title,
      subtitle: [ASSET_TYPE_LABEL[a.asset_type], a.triangle_count ? `${formatCount(a.triangle_count)} tris` : null, a.texture_size ? `${a.texture_size}px` : null, a.licence_short]
        .filter(Boolean)
        .join(" // "),
      href: assetPath(a),
      thumbnail: a.thumbnail_url ?? undefined,
    })),
    ...collections.map((c) => ({ id: `collection:${c.id}`, kind: "collection" as const, title: c.title, subtitle: `Collection // ${c.asset_count} assets`, href: `/collections/${c.slug}` })),
    ...content.map((c) => ({
      id: `${c.kind}:${c.slug}`,
      kind: c.kind,
      title: c.title,
      subtitle: c.kind === "shader" || c.kind === "starter" ? `${c.kind === "shader" ? "Shader" : "Starter project"} // ${engineLabel(c.detail)}` : c.detail,
      href: publicPath(c.kind, c.slug),
    })),
  ];
  return Response.json({ results }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=60" } });
}
