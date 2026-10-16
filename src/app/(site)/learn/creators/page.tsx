import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Creators", description: "Independent game-development creators worth following." };

export default function CreatorsPage() {
  return (
    <SectionPlaceholder
      title="Creators"
      breadcrumb="Creators"
      description="Independent creators who teach low-poly art, retro rendering and engine workflows well."
      emptyTitle="The creator directory is being curated"
      links={[{ label: "Learn", href: "/learn" }]}
    >
      <p>Creators are listed with links to their own channels. LOWPO11Y does not host or mirror their videos.</p>
    </SectionPlaceholder>
  );
}
