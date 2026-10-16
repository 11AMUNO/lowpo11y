import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Starter projects", description: "Ready-to-open engine projects with retro settings." };

export default function StarterProjectsPage() {
  return (
    <SectionPlaceholder
      title="Starter projects"
      breadcrumb="Starter projects"
      description="Engine projects configured for a retro look: one room, a camera, a controller and rights-safe sample geometry."
      emptyTitle="Starter projects are being tested"
      links={[{ label: "Shaders & Code", href: "/shaders" }]}
    >
      <p>Projects will be listed with the engine version they open in and a checksum for the download.</p>
    </SectionPlaceholder>
  );
}
