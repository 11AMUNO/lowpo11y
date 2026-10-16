import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Learn", description: "Hand-picked tutorials from independent creators." };

export default function LearnPage() {
  return (
    <SectionPlaceholder
      title="Learn"
      breadcrumb="Learn"
      description="Hand-picked tutorials on low-poly modelling, texturing, retro rendering and engine setup — linked to the creators who made them."
      emptyTitle="The tutorial directory is being curated"
      links={[{ label: "Creators", href: "/learn/creators" }, { label: "Resources", href: "/resources" }]}
    >
      <p>Every video is reviewed before it is listed, with a note on what you will learn and which engine it uses.</p>
    </SectionPlaceholder>
  );
}
