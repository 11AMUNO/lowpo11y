import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Textures", description: "Tileable textures at retro resolutions." };

export default function TexturesPage() {
  return (
    <SectionPlaceholder
      title="Textures"
      breadcrumb="Textures"
      description="Tileable textures at 64, 128 and 256 pixels, previewed with nearest-neighbour filtering so you see every texel."
      emptyTitle="The texture library is being stocked"
      links={[{ label: "Open the tools", href: "/tools" }]}
    >
      <p>Textures will appear here once they have been checked and published with a licence.</p>
    </SectionPlaceholder>
  );
}
