import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Container, PageHeader } from "@/components/site/page-header";
import { TOOLS, TOOL_CATEGORY_LABEL, type ToolCategory } from "@/features/tools/registry";

export const metadata: Metadata = {
  title: "Tools",
  description: "Browser-based tools for retro textures, palettes, atlases, bitmap fonts and low-poly models. Files stay on your device.",
  alternates: { canonical: "/tools" },
};

export default function ToolsPage() {
  const categories = [...new Set(TOOLS.map((t) => t.category))] as ToolCategory[];
  return (
    <Container wide>
      <PageHeader
        title="Tools"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Tools" }]}
        description="Each tool runs entirely in your browser. Files you open are processed on your device and are never uploaded; only your settings are remembered."
      />
      <div className="flex flex-col gap-12 py-10">
        {categories.map((cat) => (
          <section key={cat} aria-labelledby={`cat-${cat}`}>
            <h2 id={`cat-${cat}`} className="type-heading">
              {TOOL_CATEGORY_LABEL[cat]}
            </h2>
            <ul className="mt-4 grid gap-px overflow-hidden rounded-md border border-rule bg-rule md:grid-cols-2 xl:grid-cols-3">
              {TOOLS.filter((t) => t.category === cat).map((t) => (
                <li key={t.slug} id={t.slug} className="flex flex-col bg-bg p-5">
                  <div className="flex items-center justify-between gap-3">
                    {t.status === "available" ? (
                      <Link href={t.route} className="type-subheading hover:text-accent">
                        {t.name}
                      </Link>
                    ) : (
                      <h3 className="type-subheading text-muted">{t.name}</h3>
                    )}
                    {t.status === "available" ? <Badge tone="ok">Ready</Badge> : <Badge tone="outline">In development</Badge>}
                  </div>
                  <p className="type-small mt-2 text-muted">{t.summary}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Container>
  );
}
