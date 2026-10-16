import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Container, PageHeader } from "@/components/site/page-header";
import { TOOLS, TOOL_CATEGORY_LABEL, type ToolCategory } from "@/features/tools/registry";

export const metadata: Metadata = {
  title: "Tools",
  description: "Browser-based tools for retro textures, palettes, atlases, bitmap fonts and low-poly models. Files stay on your device.",
  alternates: { canonical: "/tools" },
};

export default function ToolsPage() {
  const categories = [...new Set(TOOLS.map((t) => t.category))] as ToolCategory[];
  const ready = TOOLS.filter((t) => t.status === "available").length;
  return (
    <Container wide>
      <PageHeader
        title="Tools"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Tools" }]}
        description="Each tool runs entirely in your browser. Files you open are processed on your machine and never uploaded; only your settings are remembered."
        telemetry={`${ready}/${TOOLS.length} ready // local mode // no telemetry`}
      />
      <div className="grid gap-4 py-6 lg:grid-cols-2">
        {categories.map((cat) => (
          <Panel key={cat} title={TOOL_CATEGORY_LABEL[cat]}>
            <ul className="flex flex-col gap-2">
              {TOOLS.filter((t) => t.category === cat).map((t) => (
                <li key={t.slug} id={t.slug} className="border border-rule-strong bg-sunken px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    {t.status === "available" ? (
                      <Link href={t.route} className="font-ocr text-[14px] tracking-[0.08em] uppercase glow hover:underline">
                        {t.name}
                      </Link>
                    ) : (
                      <h3 className="font-ocr text-[14px] tracking-[0.08em] text-fg uppercase">{t.name}</h3>
                    )}
                    {t.status === "available" ? <Badge tone="bright">Ready</Badge> : <Badge tone="outline">In development</Badge>}
                  </div>
                  <p className="mt-1.5 text-[13px] text-muted">{t.summary}</p>
                </li>
              ))}
            </ul>
          </Panel>
        ))}
      </div>
    </Container>
  );
}
