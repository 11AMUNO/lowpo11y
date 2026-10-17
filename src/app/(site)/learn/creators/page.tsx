import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/site/page-header";
import { CreatorCardView } from "@/features/content/cards";
import { listPublicCreators } from "@/lib/content/public";
import { PUBLIC, withDb } from "@/lib/db";
import { pluralise } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Creators",
  description: "Independent creators who teach low-poly art, retro rendering and engine workflows well.",
  alternates: { canonical: "/learn/creators" },
};

export default async function CreatorsPage() {
  const creators = await withDb(PUBLIC, (q) => listPublicCreators(q));
  return (
    <Container wide>
      <PageHeader
        title="Creators"
        description="Independent creators who teach low-poly art, retro rendering and engine workflows well. The descriptions are ours; the channels and their videos belong to them."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Learn", href: "/learn" }, { label: "Creators" }]}
        telemetry={pluralise(creators.length, "creator")}
        actions={
          <Link href="/learn" className={buttonClasses("secondary", "md")}>
            All videos
          </Link>
        }
      />
      <div className="py-6">
        {creators.length ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {creators.map((c) => (
              <li key={c.id} className="flex">
                <CreatorCardView c={c} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="The creator directory is being curated"
            action={
              <Link href="/learn" className={buttonClasses("secondary", "md")}>
                Learn
              </Link>
            }
          >
            <p>Creators are listed once we&apos;ve reviewed their channel and written a short note on what they teach.</p>
          </EmptyState>
        )}
      </div>
    </Container>
  );
}
