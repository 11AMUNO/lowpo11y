import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Assets", description: "Low-poly models, props and modular packs with clear licences." };

export default function AssetsPage() {
  return (
    <SectionPlaceholder
      title="Assets"
      breadcrumb="Assets"
      description="Low-poly models, props and modular packs with previews, mesh statistics and clear licences."
      emptyTitle="The asset library is being stocked"
      links={[{ label: "Browse textures", href: "/textures" }, { label: "Open the tools", href: "/tools" }]}
    >
      <p>Models will appear here once they have been checked and published with a licence.</p>
    </SectionPlaceholder>
  );
}
