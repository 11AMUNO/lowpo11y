import type { Metadata } from "next";
import { SectionPlaceholder } from "@/components/site/section-placeholder";

export const metadata: Metadata = { title: "Shaders & Code", description: "Engine shaders, scripts and starter projects." };

export default function ShadersPage() {
  return (
    <SectionPlaceholder
      title="Shaders & Code"
      breadcrumb="Shaders & Code"
      description="Retro-style shaders, scripts and templates for Godot, Blender and Unity, each listed with the engine version it was tested on."
      emptyTitle="Shaders are being tested"
      links={[{ label: "Starter projects", href: "/starter-projects" }]}
    >
      <p>Every entry is checked in its engine before it is listed, so this page stays empty until that testing is done.</p>
    </SectionPlaceholder>
  );
}
