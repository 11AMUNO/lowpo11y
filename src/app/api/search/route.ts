import type { SearchResult } from "@/lib/search/types";

export const dynamic = "force-dynamic";

/** Catalogue search for the command palette. Static pages and tools are matched client-side. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  const results: SearchResult[] = [];
  if (q.length < 2) return Response.json({ results });
  return Response.json({ results });
}
