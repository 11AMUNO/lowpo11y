/** The palette's built-in index (pages and tools) and how it ranks matches. Pure, so it's unit tested. */
import { TOOLS } from "@/features/tools/registry";
import type { SearchResult } from "@/lib/search/types";
import { FOOTER_NAV, PRIMARY_NAV } from "./nav";

export function buildStaticIndex(): SearchResult[] {
  const pages = new Map<string, SearchResult>();
  for (const n of PRIMARY_NAV) pages.set(n.href, { id: `page:${n.href}`, kind: "page", title: n.label, subtitle: n.description, href: n.href });
  for (const group of FOOTER_NAV)
    for (const n of group.items) if (!pages.has(n.href)) pages.set(n.href, { id: `page:${n.href}`, kind: "page", title: n.label, href: n.href });
  const tools: SearchResult[] = TOOLS.filter((t) => t.status === "available").map((t) => ({
    id: `tool:${t.slug}`,
    kind: "tool",
    title: t.name,
    subtitle: t.summary,
    href: t.route,
  }));
  return [...tools, ...pages.values()];
}

/**
 * Entries containing every word of the query, best first: matches in the
 * title before matches only in the description, then index order.
 */
export function searchStatic(index: SearchResult[], query: string): SearchResult[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return index
    .map((r, i) => {
      const title = r.title.toLowerCase(),
        hay = `${title} ${(r.subtitle ?? "").toLowerCase()}`;
      if (!words.every((w) => hay.includes(w))) return null;
      return { r, i, rank: words.every((w) => title.includes(w)) ? 0 : 1 };
    })
    .filter((x): x is { r: SearchResult; i: number; rank: number } => !!x)
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map((x) => x.r);
}
