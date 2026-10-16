import { NotFoundBody } from "@/components/site/not-found-body";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";

/** Unmatched URLs: only the root layout is above this, so it brings its own header and footer. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="flex flex-1 flex-col">
        <NotFoundBody />
      </main>
      <SiteFooter />
    </div>
  );
}
