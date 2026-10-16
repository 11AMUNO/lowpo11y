import Link from "next/link";
import type { PublicCollection } from "@/lib/assets/collections";
import { formatBytes, pluralise } from "@/lib/format";

/** Pack card: a 2×2 contact sheet of the first members, then title and size. */
export function CollectionCard({ col }: { col: PublicCollection }) {
  const cells = [...col.thumbs.slice(0, 4), ...Array<string | null>(Math.max(0, 4 - col.thumbs.length)).fill(null)];
  return (
    <Link href={`/collections/${col.slug}`} className="group flex w-full flex-col border border-rule-strong bg-panel transition-[border-color] hover:border-edge-hover focus-visible:border-bright">
      <div aria-hidden className="grid aspect-[4/1] grid-cols-4 gap-px border-b border-rule-strong bg-rule-strong">
        {cells.map((src, i) => (
          <div key={i} className="bg-sunken">
            {src ? <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-contain" /> : null}
          </div>
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        <h3 className="text-[14px] leading-snug text-fg group-hover:text-bright group-hover:[text-shadow:var(--crt-glow)]">{col.title}</h3>
        {col.summary ? <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{col.summary}</p> : null}
        <p className="mt-auto pt-1 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">
          {pluralise(col.asset_count, "asset")}
          {col.bundle_size_bytes ? ` // ZIP ${formatBytes(Number(col.bundle_size_bytes))}` : ""}
        </p>
      </div>
    </Link>
  );
}
