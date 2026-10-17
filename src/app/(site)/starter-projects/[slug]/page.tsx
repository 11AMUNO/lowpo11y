import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Container, PageHeader, Prose } from "@/components/site/page-header";
import { downloadPath } from "@/lib/content/paths";
import { getPublicStarter } from "@/lib/content/public";
import { engineLabel } from "@/lib/content/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const load = cache((slug: string) => withDb(PUBLIC, (q) => getPublicStarter(q, slug)));

export async function generateMetadata({ params }: PageProps<"/starter-projects/[slug]">): Promise<Metadata> {
  const p = await load((await params).slug);
  if (!p) return { title: "Starter project not found", robots: { index: false } };
  return {
    title: p.title,
    description: p.summary || `${p.title}: a ${engineLabel(p.engine)} starter project.`,
    alternates: { canonical: `/starter-projects/${p.slug}` },
    openGraph: { title: p.title, description: p.summary, url: `/starter-projects/${p.slug}` },
  };
}

export default async function StarterProjectPage({ params }: PageProps<"/starter-projects/[slug]">) {
  const p = await load((await params).slug);
  if (!p) notFound();
  const description = renderMarkdown(p.description_md);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: p.title,
    description: p.summary || undefined,
    url: absoluteUrl(`/starter-projects/${p.slug}`),
    runtimePlatform: [engineLabel(p.engine), p.engine_versions].filter(Boolean).join(" "),
    codeRepository: p.source_url ?? undefined,
    license: p.licence_url ?? undefined,
  };

  return (
    <Container wide>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <PageHeader
        title={p.title}
        description={p.summary || undefined}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Starter projects", href: "/starter-projects" }, { label: p.title }]}
        telemetry={[`${engineLabel(p.engine)}${p.engine_versions ? ` ${p.engine_versions}` : ""}`, p.licence_short, `tested ${formatDate(p.tested_at)}`].filter(Boolean).join(" // ")}
      />
      <div className="grid items-start gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <aside aria-label="Download and compatibility" className="flex flex-col gap-4 lg:order-2">
          <Panel title="Download">
            {p.has_download ? (
              <a href={downloadPath("starter", p.slug)} rel="nofollow" className={buttonClasses("primary", "lg", "w-full")}>
                [ Download ZIP{p.file_size_bytes ? <span className="text-muted"> {formatBytes(p.file_size_bytes)}</span> : null} ]
              </a>
            ) : (
              <p className="text-[13px] text-muted">The download is being updated. Check back shortly.</p>
            )}
            {p.file_sha256 ? <p className="mt-3 font-ocr text-[11px] tracking-[0.04em] break-all text-muted">SHA-256 {p.file_sha256}</p> : null}
            <p className="mt-2 text-xs leading-relaxed text-muted">Compare the checksum with your download to be sure it&apos;s the file we tested. Open the project folder in the engine; nothing needs installing.</p>
          </Panel>
          <Panel title="Tested with">
            <p className="text-[13px] leading-relaxed text-fg">
              {engineLabel(p.engine)}
              {p.engine_versions ? ` ${p.engine_versions}` : ""} on {formatDate(p.tested_at)}
              {p.tested_notes ? ` — ${p.tested_notes}` : ""}.
            </p>
          </Panel>
          <Panel title="Licence">
            <p className="text-[13px] text-fg">{p.licence_label ?? "Unknown"}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {p.attribution_required ? "Credit is required; the project's README says how. " : "No credit is required. "}
              <Link href="/licences" className="text-bright underline underline-offset-4">
                How licences work
              </Link>
            </p>
            {p.source_url ? (
              <p className="mt-2 text-xs text-muted">
                Source:{" "}
                <a href={p.source_url} target="_blank" rel="noopener noreferrer" className="break-all text-bright underline underline-offset-4">
                  {p.source_url.replace(/^https:\/\//, "")}
                </a>
              </p>
            ) : null}
          </Panel>
          <p className="px-1 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">Downloads: {formatCount(p.download_count)}</p>
        </aside>
        <div className="flex min-w-0 flex-col gap-5 lg:order-1">
          {p.included_features.length ? (
            <Panel title="What's included">
              <ul className="grid gap-x-6 gap-y-1.5 text-[13.5px] text-fg sm:grid-cols-2">
                {p.included_features.map((f) => (
                  <li key={f}>&gt; {f}</li>
                ))}
              </ul>
            </Panel>
          ) : null}
          {description ? (
            <Panel title="About this project">
              <Prose>
                <div dangerouslySetInnerHTML={{ __html: description }} />
              </Prose>
            </Panel>
          ) : null}
        </div>
      </div>
    </Container>
  );
}
