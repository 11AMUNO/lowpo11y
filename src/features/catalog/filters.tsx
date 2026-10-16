import Link from "next/link";
import { catalogQuery, type CatalogParams, type CatalogResult, type FacetOption } from "@/lib/assets/catalog";
import { ASSET_TYPE_LABEL, type AssetType } from "@/lib/assets/schemas";
import { cn } from "@/lib/cn";

type ListKey = "type" | "category" | "style" | "setting" | "format" | "licence" | "size" | "engine";

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Option({ href, active, label, count }: { href: string; active: boolean; label: string; count: number }) {
  return (
    <li>
      <Link
        href={href}
        scroll={false}
        aria-current={active ? "true" : undefined}
        className={cn("flex items-center gap-2 py-0.5 text-[13px] text-muted hover:text-bright", active && "text-bright")}
      >
        <span aria-hidden className={cn("grid size-3.5 shrink-0 place-items-center border", active ? "border-bright shadow-[var(--crt-glow)]" : "border-edge-strong")}>
          {active ? <span className="block size-1.5 bg-bright" /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className="font-ocr text-[11px] text-muted tabular">{count}</span>
      </Link>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-dashed border-rule-strong pt-2.5 pb-3 first:border-0 first:pt-0">
      <h3 className="type-panel mb-1.5">// {title}</h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  );
}

export function activeFilterCount(p: CatalogParams): number {
  return p.type.length + p.category.length + p.style.length + p.setting.length + p.format.length + p.licence.length + p.size.length + p.engine.length + p.tag.length + (p.tris ? 1 : 0) + (p.animated ? 1 : 0) + (p.rigged ? 1 : 0) + (p.commercial ? 1 : 0);
}

export function CatalogFilters({ basePath, params, facets, showType }: { basePath: string; params: CatalogParams; facets: CatalogResult["facets"]; showType: boolean }) {
  const base = { ...params, page: 1 };
  const listGroup = (key: ListKey, title: string, options: FacetOption[], label?: (o: FacetOption) => string) =>
    options.length ? (
      <Group title={title}>
        {options.map((o) => (
          <Option
            key={o.value}
            href={`${basePath}${catalogQuery(base, { [key]: toggle(params[key], o.value) })}`}
            active={params[key].includes(o.value)}
            label={label ? label(o) : o.label}
            count={o.count}
          />
        ))}
      </Group>
    ) : null;

  const flags = [
    { key: "commercial" as const, label: "Commercial use allowed", count: facets.commercial },
    { key: "animated" as const, label: "Animated", count: facets.animated },
    { key: "rigged" as const, label: "Rigged", count: facets.rigged },
  ].filter((f) => f.count > 0 || params[f.key]);

  return (
    <div className="flex flex-col">
      {showType && (facets.type.length > 1 || params.type.length) ? listGroup("type", "Type", facets.type, (o) => ASSET_TYPE_LABEL[o.value as AssetType] ?? o.label) : null}
      {listGroup("category", "Category", facets.category)}
      {listGroup("style", "Style", facets.style)}
      {listGroup("setting", "Setting", facets.setting)}
      {listGroup("format", "File format", facets.format)}
      {listGroup("size", "Texture size", facets.size)}
      {facets.tris.length ? (
        <Group title="Triangles">
          {facets.tris.map((o) => (
            <Option
              key={o.value}
              href={`${basePath}${catalogQuery(base, { tris: params.tris === o.value ? undefined : (o.value as CatalogParams["tris"]) })}`}
              active={params.tris === o.value}
              label={o.label}
              count={o.count}
            />
          ))}
        </Group>
      ) : null}
      {listGroup("licence", "Licence", facets.licence)}
      {listGroup("engine", "Engine", facets.engine)}
      {flags.length ? (
        <Group title="Rights and rigging">
          {flags.map((f) => (
            <Option key={f.key} href={`${basePath}${catalogQuery(base, { [f.key]: params[f.key] ? undefined : "1" })}`} active={!!params[f.key]} label={f.label} count={f.count} />
          ))}
        </Group>
      ) : null}
    </div>
  );
}
