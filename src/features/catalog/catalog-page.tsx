import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { Container, PageHeader } from "@/components/site/page-header";
import { PUBLIC, withDb } from "@/lib/db";
import { catalogQuery, parseCatalogParams, searchCatalog, type CatalogParams, type CatalogResult, type FacetOption } from "@/lib/assets/catalog";
import { ASSET_TYPE_LABEL, type AssetType } from "@/lib/assets/schemas";
import { cn } from "@/lib/cn";
import { formatCount } from "@/lib/format";
import { AssetCard, AssetRow } from "./asset-card";
import { activeFilterCount, CatalogFilters } from "./filters";

export type SearchParams = Record<string, string | string[] | undefined>;

export interface CatalogPageConfig {
  basePath: string;
  title: string;
  description: string;
  /** Plural noun for the telemetry line, e.g. "assets". */
  noun: string;
  types?: AssetType[];
  /** Where to send people when nothing matches. */
  elsewhere: { label: string; href: string };
}

/** Filtered and paged listings are not canonical: index the base page only. */
export async function catalogMetadata(cfg: CatalogPageConfig, searchParams: Promise<SearchParams>): Promise<Metadata> {
  const p = parseCatalogParams(await searchParams);
  const filtered = !!p.q || activeFilterCount(p) > 0 || p.page > 1 || p.sort !== "recent" || p.view !== "grid";
  return {
    title: p.q ? `“${p.q}” in ${cfg.title.toLowerCase()}` : cfg.title,
    description: cfg.description,
    alternates: { canonical: cfg.basePath },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

interface Chip {
  label: string;
  href: string;
}

function chips(cfg: CatalogPageConfig, p: CatalogParams, f: CatalogResult["facets"]): Chip[] {
  const base = { ...p, page: 1 };
  const labelOf = (opts: FacetOption[], v: string) => opts.find((o) => o.value === v)?.label ?? v;
  const out: Chip[] = [];
  if (p.q) out.push({ label: `“${p.q}”`, href: cfg.basePath + catalogQuery(base, { q: undefined }) });
  const list = (key: "type" | "category" | "style" | "setting" | "format" | "licence" | "size" | "engine" | "tag", label: (v: string) => string) => {
    for (const v of p[key]) out.push({ label: label(v), href: cfg.basePath + catalogQuery(base, { [key]: p[key].filter((x) => x !== v) }) });
  };
  list("type", (v) => ASSET_TYPE_LABEL[v as AssetType] ?? v);
  list("category", (v) => labelOf(f.category, v));
  list("style", (v) => labelOf(f.style, v));
  list("setting", (v) => labelOf(f.setting, v));
  list("tag", (v) => `#${v}`);
  list("format", (v) => v.toUpperCase());
  list("size", (v) => `${v}px`);
  list("licence", (v) => labelOf(f.licence, v));
  list("engine", (v) => labelOf(f.engine, v));
  if (p.tris) out.push({ label: `${labelOf(f.tris, p.tris)} tris`, href: cfg.basePath + catalogQuery(base, { tris: undefined }) });
  if (p.commercial) out.push({ label: "Commercial use", href: cfg.basePath + catalogQuery(base, { commercial: undefined }) });
  if (p.animated) out.push({ label: "Animated", href: cfg.basePath + catalogQuery(base, { animated: undefined }) });
  if (p.rigged) out.push({ label: "Rigged", href: cfg.basePath + catalogQuery(base, { rigged: undefined }) });
  return out;
}

const SORT_LABEL: Record<CatalogParams["sort"], string> = { recent: "Newest", popular: "Most downloaded", name: "A–Z" };

function Segment({ label, items }: { label: string; items: { label: string; href: string; active: boolean }[] }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">{label}</span>
      <ul className="flex">
        {items.map((i) => (
          <li key={i.label} className="-ml-px first:ml-0">
            <Link
              href={i.href}
              scroll={false}
              aria-current={i.active ? "true" : undefined}
              className={cn(
                "relative grid h-7 place-items-center border border-edge bg-sunken px-2 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:z-10 hover:border-edge-hover hover:text-bright",
                i.active && "z-10 border-bright text-bright [text-shadow:var(--crt-glow)]",
              )}
            >
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export async function CatalogPage({ cfg, searchParams }: { cfg: CatalogPageConfig; searchParams: Promise<SearchParams> }) {
  const p = parseCatalogParams(await searchParams);
  const result = await withDb(PUBLIC, (q) => searchCatalog(q, p, { types: cfg.types }));
  const { items, total, page, pageCount, facets } = result;
  const active = chips(cfg, p, facets);
  const filters = activeFilterCount(p);
  const showType = !cfg.types || cfg.types.length > 1;
  const href = (o: Partial<CatalogParams>) => cfg.basePath + catalogQuery(p, o);

  const telemetry = [
    `${formatCount(total)} ${total === 1 ? cfg.noun.replace(/s$/, "") : cfg.noun}`,
    p.q ? `matching “${p.q}”` : null,
    filters ? `${filters} ${filters === 1 ? "filter" : "filters"}` : null,
    pageCount > 1 ? `page ${page}/${pageCount}` : null,
  ]
    .filter(Boolean)
    .join(" // ");

  // Preserve every other parameter when the search box is resubmitted.
  const hidden = new URLSearchParams(catalogQuery({ ...p, q: undefined, page: 1 }).slice(1));

  return (
    <Container wide>
      <PageHeader title={cfg.title} description={cfg.description} breadcrumbs={[{ label: "Home", href: "/" }, { label: cfg.title }]} telemetry={telemetry} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-rule-strong py-4">
        <form action={cfg.basePath} method="get" role="search" className="flex min-w-[min(100%,22rem)] flex-1 gap-2">
          {[...hidden.entries()].map(([k, v]) => (
            <input key={k} type="hidden" name={k} value={v} />
          ))}
          <label htmlFor="catalog-q" className="sr-only">
            Search {cfg.title.toLowerCase()}
          </label>
          <div className="flex flex-1 items-center border border-edge-strong bg-sunken focus-within:border-bright focus-within:shadow-[var(--crt-glow)] hover:border-edge-hover">
            <span aria-hidden className="px-2 font-ocr text-muted">
              &gt;
            </span>
            <input
              id="catalog-q"
              name="q"
              type="search"
              defaultValue={p.q ?? ""}
              maxLength={120}
              placeholder={cfg.types?.includes("texture") ? "rust, brick, 64px…" : "crate, barrier, lamp…"}
              className="h-9 min-w-0 flex-1 bg-transparent pr-2 text-[14px] text-bright caret-white outline-none placeholder:text-muted"
            />
          </div>
          <button type="submit" className={buttonClasses("primary", "md", "h-9")}>
            [ Search ]
          </button>
        </form>
        <Segment label="Sort" items={(["recent", "popular", "name"] as const).map((s) => ({ label: SORT_LABEL[s], href: href({ sort: s, page: 1 }), active: p.sort === s }))} />
        <Segment
          label="View"
          items={[
            { label: "Grid", href: href({ view: "grid" }), active: p.view === "grid" },
            { label: "List", href: href({ view: "list" }), active: p.view === "list" },
          ]}
        />
      </div>

      {active.length ? (
        <div className="flex flex-wrap items-center gap-2 border-b border-dashed border-rule-strong py-3">
          <span className="font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">Active</span>
          <ul className="flex flex-wrap gap-1.5">
            {active.map((c) => (
              <li key={c.href + c.label}>
                <Link
                  href={c.href}
                  scroll={false}
                  aria-label={`Remove filter: ${c.label}`}
                  className="inline-flex h-6 items-center gap-1.5 border border-edge bg-sunken px-1.5 font-ocr text-[11px] tracking-[0.04em] text-fg hover:border-bright hover:text-bright"
                >
                  {c.label}
                  <span aria-hidden className="text-muted">
                    ×
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link href={cfg.basePath + catalogQuery({ sort: p.sort, view: p.view })} className="font-ocr text-[11px] tracking-[0.08em] text-muted uppercase underline-offset-4 hover:text-bright hover:underline">
            Clear all
          </Link>
        </div>
      ) : null}

      <div className="grid items-start gap-6 py-5 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <aside aria-label="Filters" className="lg:sticky lg:top-4">
          <details className="group border border-rule-strong bg-panel lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 font-ocr text-xs tracking-[0.08em] text-fg uppercase [&::-webkit-details-marker]:hidden">
              <span>
                [ Filters{filters ? ` (${filters})` : ""} ]
              </span>
              <span aria-hidden className="text-muted group-open:rotate-90">
                ▶
              </span>
            </summary>
            <div className="border-t border-rule-strong p-3">
              <CatalogFilters basePath={cfg.basePath} params={p} facets={facets} showType={showType} />
            </div>
          </details>
          <div className="hidden border border-rule-strong bg-panel p-3 lg:block">
            <CatalogFilters basePath={cfg.basePath} params={p} facets={facets} showType={showType} />
          </div>
        </aside>

        <section aria-label="Results" className="min-w-0">
          {items.length === 0 ? (
            <EmptyState
              title={p.q || filters ? "No matches" : `No ${cfg.noun} published yet`}
              action={
                <>
                  {filters || p.q ? (
                    <Link href={cfg.basePath} className={buttonClasses("secondary", "md")}>
                      Clear search and filters
                    </Link>
                  ) : null}
                  <Link href={cfg.elsewhere.href} className={buttonClasses("secondary", "md")}>
                    {cfg.elsewhere.label}
                  </Link>
                </>
              }
            >
              {p.q || filters ? (
                <p>
                  Nothing matches {p.q ? <>“{p.q}”</> : "these filters"}
                  {p.q && filters ? " with these filters" : ""}. Try fewer filters, a shorter word, or a broader term such as “metal” or “prop”.
                </p>
              ) : (
                <p>{cfg.title} appear here once they have been checked and published with a licence.</p>
              )}
            </EmptyState>
          ) : p.view === "list" ? (
            <ul className="border-t border-dashed border-rule-strong">
              {items.map((item) => (
                <li key={item.id}>
                  <AssetRow item={item} />
                </li>
              ))}
            </ul>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
              {items.map((item, i) => (
                <li key={item.id} className="flex">
                  <AssetCard item={item} priority={i < 6} />
                </li>
              ))}
            </ul>
          )}
          <Pagination page={page} pageCount={pageCount} hrefFor={(n) => href({ page: n })} className="mt-6" />
        </section>
      </div>
    </Container>
  );
}
