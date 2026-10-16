import Link from "next/link";
import { cn } from "@/lib/cn";

export interface PaginationProps {
  page: number;
  pageCount: number;
  /** Builds the URL for a page number, preserving the current filters. */
  hrefFor: (page: number) => string;
  className?: string;
}

function pageWindow(page: number, count: number): (number | "gap")[] {
  const pages = new Set([1, count, page - 1, page, page + 1].filter((p) => p >= 1 && p <= count));
  const sorted = [...pages].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

export function Pagination({ page, pageCount, hrefFor, className }: PaginationProps) {
  if (pageCount <= 1) return null;
  const item = "grid h-8 min-w-8 place-items-center border border-edge bg-sunken px-2 font-ocr text-xs text-muted hover:border-edge-hover hover:text-bright";
  return (
    <nav aria-label="Pagination" className={cn("flex items-center gap-1.5", className)}>
      {page > 1 ? (
        <Link href={hrefFor(page - 1)} className={item} rel="prev" aria-label="Previous page">
          ◀
        </Link>
      ) : null}
      {pageWindow(page, pageCount).map((p, i) =>
        p === "gap" ? (
          <span key={`gap-${i}`} className="px-1 font-ocr text-muted" aria-hidden>
            …
          </span>
        ) : (
          <Link
            key={p}
            href={hrefFor(p)}
            aria-current={p === page ? "page" : undefined}
            aria-label={`Page ${p}`}
            className={cn(item, p === page && "border-bright text-bright [text-shadow:var(--crt-glow)]")}
          >
            {String(p).padStart(2, "0")}
          </Link>
        ),
      )}
      {page < pageCount ? (
        <Link href={hrefFor(page + 1)} className={item} rel="next" aria-label="Next page">
          ▶
        </Link>
      ) : null}
    </nav>
  );
}
