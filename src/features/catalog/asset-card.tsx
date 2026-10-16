import Link from "next/link";
import type { CatalogItem } from "@/lib/assets/catalog";
import { ASSET_TYPE_LABEL, assetPath } from "@/lib/assets/schemas";
import { formatCount } from "@/lib/format";
import { cn } from "@/lib/cn";

export function assetHref(item: Pick<CatalogItem, "slug" | "asset_type">) {
  return assetPath(item);
}

export function assetMeta(item: Pick<CatalogItem, "asset_type" | "triangle_count" | "texture_size" | "formats">): string[] {
  const parts: string[] = [ASSET_TYPE_LABEL[item.asset_type]];
  if (item.triangle_count) parts.push(`${formatCount(item.triangle_count)} tris`);
  if (item.texture_size) parts.push(`${item.texture_size}px`);
  if (item.formats.length) parts.push(item.formats.slice(0, 3).join(" ").toUpperCase());
  return parts;
}

const isTextureLike = (t: string) => t === "texture" || t === "decal" || t === "sprite" || t === "ui";

export function AssetCard({ item, priority }: { item: CatalogItem; priority?: boolean }) {
  return (
    <Link
      href={assetHref(item)}
      className="group flex w-full flex-col border border-rule-strong bg-panel transition-[border-color,box-shadow] hover:border-edge-hover focus-visible:border-bright"
    >
      <div className={cn("relative aspect-square overflow-hidden border-b border-rule-strong", isTextureLike(item.asset_type) ? "bg-checker" : "bg-sunken")}>
        {item.thumbnail_url ? (
          <img
            src={item.thumbnail_url}
            alt={`${item.title} preview`}
            width={512}
            height={512}
            loading={priority ? "eager" : "lazy"}
            decoding="async"
            className={cn("h-full w-full object-contain", isTextureLike(item.asset_type) && "pixelated")}
          />
        ) : (
          <div className="grid h-full place-items-center font-ocr text-xs text-muted">NO PREVIEW</div>
        )}
        {item.is_demo ? (
          <span className="absolute top-1.5 left-1.5 border border-rule-strong bg-black/80 px-1 font-ocr text-[10px] tracking-[0.1em] text-muted">DEMO</span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <h3 className="line-clamp-2 text-[13.5px] leading-snug text-fg group-hover:text-bright group-hover:[text-shadow:var(--crt-glow)]">{item.title}</h3>
        <p className="line-clamp-1 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">{assetMeta(item).join(" // ")}</p>
        {item.licence_short ? <p className="mt-auto font-ocr text-[11px] tracking-[0.06em] text-muted">{item.licence_short}</p> : null}
      </div>
    </Link>
  );
}

export function AssetRow({ item }: { item: CatalogItem }) {
  return (
    <Link href={assetHref(item)} className="group grid grid-cols-[56px_1fr] items-center gap-3 border-b border-dashed border-rule-strong px-1 py-2 hover:bg-hover sm:grid-cols-[56px_1fr_auto]">
      <span className={cn("block size-14 border border-rule-strong", isTextureLike(item.asset_type) ? "bg-checker" : "bg-sunken")}>
        {item.thumbnail_url ? (
          <img src={item.thumbnail_url} alt="" width={56} height={56} loading="lazy" className={cn("h-full w-full object-contain", isTextureLike(item.asset_type) && "pixelated")} />
        ) : null}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13.5px] text-fg group-hover:text-bright">
          {item.title}
          {item.is_demo ? <span className="ml-2 font-ocr text-[10px] tracking-[0.1em] text-muted">DEMO</span> : null}
        </span>
        <span className="block truncate text-xs text-muted">{item.short_description}</span>
      </span>
      <span className="hidden text-right font-ocr text-[11px] tracking-[0.06em] text-muted uppercase sm:block">
        {assetMeta(item).join(" // ")}
        <br />
        {item.licence_short}
      </span>
    </Link>
  );
}
