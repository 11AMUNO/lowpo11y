import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Resources", description: "Vetted external tools, references and free asset sources." };

export default function ResourcesPage() {
  return (
    <SectionPlaceholder
      title="Resources"
      breadcrumb="Resources"
      description="External tools, references and free asset sources, each checked for licence terms before it is listed."
      emptyTitle="Resources are being checked"
      links={[{ label: "Learn", href: "/learn" }]}
    >
      <p>Third-party downloads are linked at their source rather than re-hosted unless their licence allows redistribution.</p>
    </SectionPlaceholder>
  );
}
