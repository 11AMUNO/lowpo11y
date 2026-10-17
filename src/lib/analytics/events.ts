/**
 * Usage events: what the site counts, shared by the browser beacon and the
 * server. Every event is a name plus a short subject from a closed set (a
 * page section, a tool, a format), so the counts can't carry identifiers or
 * free text. See ADR 0012 and the privacy page. No dependencies, so it is
 * cheap to include in any bundle (the request schema is in payload.ts).
 */
export const USAGE_EVENTS = [
  /** A page was shown; subject = its section (`sectionOf`). */
  "page_view",
  /** First page this browser showed today; subject "new" or "returning" (decided on the device). */
  "visit",
  /** A catalogue search; subject "assets" or "textures". */
  "search",
  /** A download link was used; subject "search" (after a search in this tab) or "browse". */
  "download",
  /** A tool, the Workshop or the Scene Builder saved a file; subject "{section}:{extension}". */
  "export",
  /** A 3D preview loaded or failed; subject "{where}:ok" or "{where}:error". */
  "preview",
  /** A Core Web Vital; subject "{metric}:{section}", with its value. */
  "vital",
] as const;
export type UsageEvent = (typeof USAGE_EVENTS)[number];

export const VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;


const TOOL = /^\/tools\/([a-z0-9-]+)/;

/** The section a path belongs to, the only page detail that is counted. Null for pages that aren't counted (admin, sign-in, API). */
export function sectionOf(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (/^\/(admin|auth|api)(\/|$)/.test(p)) return null;
  if (p === "/") return "home";
  const tool = TOOL.exec(p);
  if (tool) return `tool-${tool[1]}`.slice(0, 40);
  const [first = "", second] = p.slice(1).split("/");
  const known: Record<string, [list: string, item: string]> = {
    assets: ["assets", "asset"],
    textures: ["textures", "texture"],
    collections: ["collections", "collection"],
    shaders: ["shaders", "shader"],
    "starter-projects": ["starters", "starter"],
    learn: ["learn", "learn-page"],
    tools: ["tools", "tools"],
  };
  const k = known[first];
  if (k) return second ? k[1] : k[0];
  if (["workshop", "scene-builder", "resources", "about", "licences", "privacy", "terms", "contact"].includes(first)) return first;
  return "other";
}

/** The subject for an exported file: "{section}:{extension}". */
export function exportSubject(pathname: string, filename: string): string {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(filename)?.[1]?.toLowerCase() ?? "file";
  // ".retro-scene.json" and ".json" files are told apart.
  const kind = /\.retro-scene\.json$/i.test(filename) ? "scene" : ext;
  return `${sectionOf(pathname) ?? "other"}:${kind}`.slice(0, 64);
}
