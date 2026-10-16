import type { MetadataRoute } from "next";
import { TOOLS } from "@/features/tools/registry";
import { absoluteUrl } from "@/lib/site";

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

export default function sitemap(): MetadataRoute.Sitemap {
  const tools = TOOLS.filter((t) => t.status === "available").map((t) => t.route);
  return [...STATIC_ROUTES, ...tools].map((path) => ({
    url: absoluteUrl(path),
    changeFrequency: path === "/" ? "daily" : "weekly",
    priority: path === "/" ? 1 : 0.6,
  }));
}
