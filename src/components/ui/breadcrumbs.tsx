import Link from "next/link";
import { absoluteUrl } from "@/lib/site";

export interface Crumb {
  label: string;
  href?: string;
}

/** Visible breadcrumb trail plus BreadcrumbList JSON-LD. The last crumb is the current page. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.label,
      ...(c.href ? { item: absoluteUrl(c.href) } : {}),
    })),
  };
  return (
    <nav aria-label="Breadcrumb" className="font-ocr text-xs tracking-[0.08em] text-muted uppercase">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} className="flex items-center gap-1.5">
              {c.href && !last ? (
                <Link href={c.href} className="hover:text-bright">
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} className={last ? "text-bright" : undefined}>
                  {c.label}
                </span>
              )}
              {!last ? (
                <span aria-hidden className="text-faint">
                  //
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
    </nav>
  );
}
