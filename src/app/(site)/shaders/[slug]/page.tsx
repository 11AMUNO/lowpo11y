import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Container, PageHeader, Prose } from "@/components/site/page-header";
import { languageLabel } from "@/features/content/cards";
import { CodeBlock } from "@/features/content/code-block";
import { ShaderPreview } from "@/features/content/shader-preview/shader-preview";
import { splitStages } from "@/features/content/shader-preview/parse";
import { codeExtension, testedLine } from "@/lib/content/bundles";
import { downloadPath } from "@/lib/content/paths";
import { getPublicShader } from "@/lib/content/public";
import { engineLabel } from "@/lib/content/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { formatBytes, formatCount, formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const load = cache((slug: string) => withDb(PUBLIC, (q) => getPublicShader(q, slug)));

export async function generateMetadata({ params }: PageProps<"/shaders/[slug]">): Promise<Metadata> {
  const s = await load((await params).slug);
  if (!s) return { title: "Shader not found", robots: { index: false } };
  return {
    title: s.title,
    description: s.summary || `${s.title}: a ${engineLabel(s.engine)} shader with setup steps and limitations.`,
    alternates: { canonical: `/shaders/${s.slug}` },
    openGraph: { title: s.title, description: s.summary, url: `/shaders/${s.slug}` },
  };
}

function Section({ title, md }: { title: string; md: string }) {
  const html = renderMarkdown(md);
  if (!html) return null;
  return (
    <Panel title={title}>
      <Prose>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </Prose>
    </Panel>
  );
}

export default async function ShaderPage({ params }: PageProps<"/shaders/[slug]">) {
  const s = await load((await params).slug);
  if (!s) notFound();
  const live = s.engine === "threejs" && s.code && splitStages(s.code);
  const filename = `${s.slug}.${codeExtension(s.code_language)}`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    name: s.title,
    description: s.summary || undefined,
    url: absoluteUrl(`/shaders/${s.slug}`),
    programmingLanguage: languageLabel(s.code_language) ?? undefined,
    runtimePlatform: engineLabel(s.engine),
    license: s.licence_url ?? undefined,
    dateModified: new Date(s.updated_at).toISOString(),
  };

  return (
    <Container wide>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <PageHeader
        title={s.title}
        description={s.summary || undefined}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Shaders & Code", href: "/shaders" }, { label: s.title }]}
        telemetry={[engineLabel(s.engine), languageLabel(s.code_language), s.licence_short].filter(Boolean).join(" // ")}
      />

      <div className="grid items-start gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <aside aria-label="Download and compatibility" className="flex flex-col gap-4 lg:order-2">
          <Panel title="Download">
            {s.has_download ? (
              <a href={downloadPath("shader", s.slug)} rel="nofollow" className={buttonClasses("primary", "lg", "w-full")}>
                [ Download ZIP{s.file_size_bytes ? <span className="text-muted"> {formatBytes(s.file_size_bytes)}</span> : null} ]
              </a>
            ) : (
              <p className="text-[13px] text-muted">The download is being rebuilt. Copy the code below in the meantime.</p>
            )}
            <p className="mt-3 text-xs leading-relaxed text-muted">
              {filename}, README.md (explanation, setup, limitations, tested versions) and LICENSE.txt.
            </p>
            {s.file_sha256 ? <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] break-all text-muted">SHA-256 {s.file_sha256}</p> : null}
          </Panel>
          <Panel title="Tested with">
            <p className="text-[13px] leading-relaxed text-fg">{testedLine(s)}.</p>
            <dl className="mt-3 grid grid-cols-[7.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-muted">Engine</dt>
              <dd className="text-fg">{engineLabel(s.engine)}</dd>
              <dt className="text-muted">Versions</dt>
              <dd className="text-fg">{[s.engine_version_min, s.engine_version_max].filter(Boolean).join(" – ") || "Not recorded"}</dd>
              <dt className="text-muted">Renderer</dt>
              <dd className="text-fg">{s.renderer_compatibility ?? "Not recorded"}</dd>
              <dt className="text-muted">Published</dt>
              <dd className="text-fg">{formatDate(s.published_at)}</dd>
              <dt className="text-muted">Updated</dt>
              <dd className="text-fg">{formatDate(s.updated_at)}</dd>
            </dl>
          </Panel>
          <Panel title="Licence">
            <p className="text-[13px] text-fg">{s.licence_label ?? "Unknown"}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted">
              {s.attribution_required ? "Credit is required: LICENSE.txt in the download says how. " : "No credit is required. "}
              {s.commercial_use === false ? "Not for commercial projects." : s.commercial_use ? "Commercial projects are fine." : ""}{" "}
              <Link href="/licences" className="text-bright underline underline-offset-4">
                How licences work
              </Link>
            </p>
            {s.source_url ? (
              <p className="mt-2 text-xs text-muted">
                Original source:{" "}
                <a href={s.source_url} target="_blank" rel="noopener noreferrer" className="break-all text-bright underline underline-offset-4">
                  {s.source_url.replace(/^https:\/\//, "")}
                </a>
              </p>
            ) : null}
          </Panel>
          <p className="px-1 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">Downloads: {formatCount(s.download_count)}</p>
        </aside>

        <div className="flex min-w-0 flex-col gap-5 lg:order-1">
          {live ? <ShaderPreview code={s.code!} /> : null}
          <Section title="What it does" md={s.explanation_md} />
          {s.code ? <CodeBlock code={s.code} filename={filename} language={languageLabel(s.code_language) ?? "Code"} /> : null}
          <Section title="Setup" md={s.setup_md} />
          <Section title="Limitations" md={s.limitations_md} />
          <Section title="Changelog" md={s.changelog_md} />
        </div>
      </div>
    </Container>
  );
}
