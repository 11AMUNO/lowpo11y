import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 py-20 sm:px-6">
        <pre aria-hidden className="font-mono text-[13px] leading-tight text-muted">
          {"┌────────────────────────────────────┐\n│  NO SIGNAL // 404                  │\n│  > page not found in the library_  │\n└────────────────────────────────────┘"}
        </pre>
        <h1 className="type-display mt-6">This page isn’t in the library</h1>
        <p className="mt-3 max-w-[60ch] text-[15px] text-muted">
          The address may be mistyped, or the item may have been unpublished. Search the library or start from one of
          these sections.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/assets" className={buttonClasses("primary", "md")}>
            [ Browse assets ]
          </Link>
          <Link href="/textures" className={buttonClasses("secondary", "md")}>
            Browse textures
          </Link>
          <Link href="/tools" className={buttonClasses("secondary", "md")}>
            Open the tools
          </Link>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
