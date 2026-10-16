import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Collections", description: "Curated packs of matching assets." };

export default function CollectionsPage() {
  return (
    <SectionPlaceholder
      title="Collections"
      breadcrumb="Collections"
      description="Curated packs of assets that share a scale, palette and texture budget, downloadable as one ZIP."
      emptyTitle="No collections yet"
      links={[{ label: "Browse assets", href: "/assets" }]}
    >
      <p>Collections are assembled from published assets and will be listed here.</p>
    </SectionPlaceholder>
  );
}
