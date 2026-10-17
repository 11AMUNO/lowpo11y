import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Panel } from "@/components/ui/panel";
import { Container, PageHeader } from "@/components/site/page-header";
import { ResourceRow } from "@/features/content/cards";
import { listPublicResources } from "@/lib/content/public";
import { RESOURCE_CATEGORIES } from "@/lib/content/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { pluralise } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Resources",
  description: "Free tools, references and asset sources for retro and low-poly game development, with licence notes and review dates.",
  alternates: { canonical: "/resources" },
};

export default async function ResourcesPage() {
  const all = await withDb(PUBLIC, (q) => listPublicResources(q));
  const groups = RESOURCE_CATEGORIES.map((c) => ({ ...c, items: all.filter((r) => r.category === c.id) })).filter((g) => g.items.length);

  return (
    <Container wide>
      <PageHeader
        title="Resources"
        description="Free tools, references and asset sources we've checked. We link to the original site and don't rehost anything; each entry notes what its licence allows and when we last reviewed it. Always check the source's own terms before you ship."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Resources" }]}
        telemetry={`${pluralise(all.length, "link")}${groups.length ? ` // ${pluralise(groups.length, "category", "categories")}` : ""}`}
        actions={
          <Link href="/learn" className={buttonClasses("secondary", "md")}>
            Learn
          </Link>
        }
      />
      {groups.length ? (
        <div className="grid items-start gap-5 py-5 lg:grid-cols-[14rem_minmax(0,1fr)]">
          <nav aria-label="Categories" className="lg:sticky lg:top-20">
            <ul className="flex flex-wrap gap-1.5 lg:flex-col lg:gap-0">
              {groups.map((g) => (
                <li key={g.id}>
                  <a href={`#cat-${g.id}`} className="flex items-baseline justify-between gap-3 py-1 text-[13px] text-muted hover:text-bright max-lg:border max-lg:border-edge max-lg:px-2">
                    {g.label}
                    <span className="font-ocr text-[11px]">{g.items.length}</span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <div className="flex min-w-0 flex-col gap-5">
            {groups.map((g) => (
              <Panel key={g.id} title={g.label} labelledBy={`cat-${g.id}`} className="scroll-mt-20">
                <ul>
                  {g.items.map((r) => (
                    <ResourceRow key={r.id} r={r} />
                  ))}
                </ul>
              </Panel>
            ))}
          </div>
        </div>
      ) : (
        <div className="py-6">
          <EmptyState
            title="The resource list is being reviewed"
            action={
              <Link href="/licences" className={buttonClasses("secondary", "md")}>
                Licence guide
              </Link>
            }
          >
            <p>Each link is checked for licensing and availability before it&apos;s listed.</p>
          </EmptyState>
        </div>
      )}
    </Container>
  );
}
