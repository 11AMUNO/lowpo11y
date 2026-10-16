import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/site/page-header";
import { CollectionCard } from "@/features/catalog/collection-card";
import { listPublicCollections } from "@/lib/assets/collections";
import { PUBLIC, withDb } from "@/lib/db";
import { pluralise } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Collections",
  description: "Curated packs of assets that share a scale, palette and texture budget, downloadable as one ZIP.",
  alternates: { canonical: "/collections" },
};

export default async function CollectionsPage() {
  const cols = await withDb(PUBLIC, (q) => listPublicCollections(q));
  const assets = cols.reduce((n, c) => n + c.asset_count, 0);
  return (
    <Container wide>
      <PageHeader
        title="Collections"
        description="Curated packs of assets that share a scale, palette and texture budget. Each downloads as one ZIP with every licence notice included."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Collections" }]}
        telemetry={`${pluralise(cols.length, "pack")} // ${pluralise(assets, "asset")}`}
      />
      <div className="py-6">
        {cols.length ? (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {cols.map((c) => (
              <li key={c.id} className="flex">
                <CollectionCard col={c} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="No collections yet"
            action={
              <Link href="/assets" className={buttonClasses("secondary", "md")}>
                Browse assets
              </Link>
            }
          >
            <p>Collections are assembled from published assets and will be listed here.</p>
          </EmptyState>
        )}
      </div>
    </Container>
  );
}
