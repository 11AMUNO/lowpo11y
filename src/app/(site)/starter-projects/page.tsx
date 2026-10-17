import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/site/page-header";
import { StarterCardView } from "@/features/content/cards";
import { listPublicStarters } from "@/lib/content/public";
import { PUBLIC, withDb } from "@/lib/db";
import { pluralise } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Starter projects",
  description: "Engine projects set up for a retro look, with sample scenes and controllers, tested before they're listed.",
  alternates: { canonical: "/starter-projects" },
};

export default async function StarterProjectsPage() {
  const projects = await withDb(PUBLIC, (q) => listPublicStarters(q));
  return (
    <Container wide>
      <PageHeader
        title="Starter projects"
        description="Projects configured for a retro look, with a sample scene, a controller and rights-safe sample assets. Each one is opened and run in its engine before it's listed, and the ZIP has a checksum so you know it's the one we tested."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Starter projects" }]}
        telemetry={pluralise(projects.length, "project")}
        actions={
          <Link href="/shaders" className={buttonClasses("secondary", "md")}>
            Shaders & Code
          </Link>
        }
      />
      <div className="py-6">
        {projects.length ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => (
              <li key={p.id} className="flex">
                <StarterCardView p={p} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            title="Starter projects are being tested"
            action={
              <Link href="/shaders" className={buttonClasses("secondary", "md")}>
                Browse shaders
              </Link>
            }
          >
            <p>Each project is opened and run in its engine before it&apos;s listed, so this page stays empty until that testing is done.</p>
          </EmptyState>
        )}
      </div>
    </Container>
  );
}
