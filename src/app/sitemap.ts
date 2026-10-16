import type { MetadataRoute } from "next";
import { TOOLS } from "@/features/tools/registry";
import { assetPath } from "@/lib/assets/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { absoluteUrl } from "@/lib/site";

// Built per request so newly published assets appear without a redeploy.
export const dynamic = "force-dynamic";

const STATIC_ROUTES = [
  "/",
  "/assets",
  "/textures",
  "/collections",
  "/tools",
  "/shaders",
  "/starter-projects",
  "/learn",
  "/learn/creators",
  "/resources",
  "/about",
  "/licences",
  "/privacy",
  "/terms",
  "/contact",
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const tools = TOOLS.filter((t) => t.status === "available").map((t) => t.route);
  const pages: MetadataRoute.Sitemap = [...STATIC_ROUTES, ...tools].map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.6,
  }));
  const { assets, collections } = await withDb(PUBLIC, async (q) => ({
    assets: await q.query<{ slug: string; asset_type: string; updated_at: Date }>(
      "select slug, asset_type, updated_at from assets where status = 'published' and deleted_at is null order by published_at desc limit 45000",
    ),
    collections: await q.query<{ slug: string; updated_at: Date }>("select slug, updated_at from collections where status = 'published' and deleted_at is null"),
  }));
  return [
    ...pages,
    ...assets.map((a) => ({ url: absoluteUrl(assetPath(a)), lastModified: new Date(a.updated_at), changeFrequency: "monthly" as const, priority: 0.7 })),
    ...collections.map((c) => ({ url: absoluteUrl(`/collections/${c.slug}`), lastModified: new Date(c.updated_at), changeFrequency: "weekly" as const, priority: 0.7 })),
  ];
}
