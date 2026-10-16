import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Container, PageHeader, Prose } from "@/components/site/page-header";
import { getPublicAsset, type PublicAsset, type PublicFile } from "@/lib/assets/catalog";
import { ASSET_TYPE_LABEL, assetPath, PROVENANCE_LABEL } from "@/lib/assets/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { formatCount, formatDate } from "@/lib/format";
import { renderMarkdown } from "@/lib/markdown";
import { absoluteUrl } from "@/lib/site";
import { getStorage } from "@/lib/storage";
import { ModelViewer } from "@/features/viewer/model-viewer";
import { TextureViewer } from "@/features/viewer/texture-viewer";
import { AssetCard } from "./asset-card";
import { CopyButton, DownloadPanel, type DownloadFile } from "./download-panel";

export const loadPublicAsset = cache((slug: string) => withDb(PUBLIC, (q) => getPublicAsset(q, slug)));

const GENERATED_NOTE: Record<string, string> = {
  "fbx-to-glb": "Converted from the original FBX",
  "texture-variant": "Nearest-neighbour downscale",
};

function fileDetail(f: PublicFile): string {
  const parts: string[] = [];
  if (f.width && f.height) parts.push(`${f.width}×${f.height}`);
  if (f.model_triangle_count) parts.push(`${formatCount(f.model_triangle_count)} tris`);
  const gen = f.metadata?.generated as string | undefined;
  if (gen && GENERATED_NOTE[gen]) parts.push(GENERATED_NOTE[gen]);
  else if (f.is_primary) parts.push("Original");
  return parts.join(" // ");
}

const toDownload = (f: PublicFile): DownloadFile => ({ id: f.id, filename: f.original_filename, format: f.format, sizeBytes: Number(f.size_bytes), detail: fileDetail(f) });

function pickViewer(data: PublicAsset) {
  const { asset, files } = data;
  const storage = getStorage();
  const url = (f: PublicFile) => storage.publicUrl(f.public_key!);
  const glb =
    files.find((f) => f.format === "glb" && f.purpose === "preview") ??
    files.find((f) => f.format === "glb" && f.purpose === "delivery" && f.is_primary) ??
    files.find((f) => f.format === "glb" && f.purpose === "delivery");
  if (glb && ["model", "pack", "animation"].includes(asset.asset_type)) return { kind: "model" as const, src: url(glb) };
  const image =
    files.find((f) => f.purpose === "delivery" && f.is_primary && f.width && !f.metadata?.generated) ??
    files.find((f) => f.purpose === "delivery" && f.width && !f.metadata?.generated) ??
    files.find((f) => f.purpose === "preview" && f.width);
  if (image) return { kind: "texture" as const, src: url(image), width: image.width!, height: image.height! };
  return null;
}

function creditLine(data: PublicAsset): string {
  const a = data.asset;
  return a.attribution_text?.trim() || `“${a.title}” from LOWPO11Y (${absoluteUrl(assetPath(a))}), ${a.licence_short ?? a.licence_label ?? "see licence"}`;
}

export async function assetDetailMetadata(slug: string): Promise<Metadata> {
  const data = await loadPublicAsset(slug);
  if (!data) return { title: "Asset not found", robots: { index: false } };
  const a = data.asset;
  const path = assetPath(a);
  const image = a.thumbnail_url ? absoluteUrl(a.thumbnail_url) : undefined;
  return {
    title: a.title,
    description: a.short_description || `${ASSET_TYPE_LABEL[a.asset_type]} on LOWPO11Y.`,
    alternates: { canonical: path },
    openGraph: { title: a.title, description: a.short_description, url: path, type: "website", images: image ? [{ url: image, width: 512, height: 512, alt: `${a.title} preview` }] : undefined },
    twitter: { card: image ? "summary_large_image" : "summary" },
  };
}

function Right({ label, value }: { label: string; value: boolean | null }) {
  const text = value === null ? "Check licence" : value ? "Yes" : "No";
  return (
    <li className="flex items-baseline justify-between gap-3 border-b border-dashed border-rule-strong py-1.5 text-[13px] last:border-0">
      <span className="text-muted">{label}</span>
      <span className={value ? "font-ocr text-xs tracking-[0.08em] uppercase glow" : "font-ocr text-xs tracking-[0.08em] text-fg uppercase"}>
        <span aria-hidden>{value === null ? "[?]" : value ? "[✓]" : "[ ]"} </span>
        {text}
      </span>
    </li>
  );
}

function Spec({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-3 border-b border-dashed border-rule-strong py-1.5 text-[13px] last:border-0">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 text-fg">{children}</dd>
    </div>
  );
}

function jsonLd(data: PublicAsset) {
  const a = data.asset;
  const url = absoluteUrl(assetPath(a));
  const isModel = a.asset_type === "model" || a.asset_type === "pack" || a.asset_type === "animation";
  return {
    "@context": "https://schema.org",
    "@type": isModel ? "3DModel" : a.asset_type === "audio" ? "AudioObject" : "ImageObject",
    name: a.title,
    description: a.short_description || undefined,
    url,
    image: a.thumbnail_url ? absoluteUrl(a.thumbnail_url) : undefined,
    thumbnailUrl: a.thumbnail_url ? absoluteUrl(a.thumbnail_url) : undefined,
    license: a.licence_url ?? undefined,
    acquireLicensePage: absoluteUrl("/licences"),
    isAccessibleForFree: true,
    datePublished: new Date(a.published_at).toISOString(),
    dateModified: new Date(a.updated_at).toISOString(),
    keywords: data.tags.map((t) => t.name).join(", ") || undefined,
    encodingFormat: a.formats.map((f) => f.toUpperCase()).join(", ") || undefined,
    creator: data.creators.length ? data.creators.map((c) => ({ "@type": "Person", name: c.name, url: c.url ?? undefined })) : { "@type": "Organization", name: "LOWPO11Y" },
  };
}

export async function AssetDetailPage({ slug, section }: { slug: string; section: "assets" | "textures" }) {
  const data = await loadPublicAsset(slug);
  if (!data) notFound();
  const { asset: a, files, tags, creators, collections, dependencies, related } = data;
  const path = assetPath(a);
  if (path !== `/${section}/${slug}`) permanentRedirect(path);

  const viewer = pickViewer(data);
  const bundleFile = files.find((f) => f.purpose === "bundle") ?? null;
  const deliveries = files
    .filter((f) => f.purpose === "delivery" || f.purpose === "dependency")
    .sort((x, y) => Number(y.is_primary) - Number(x.is_primary) || Number(!!x.metadata?.generated) - Number(!!y.metadata?.generated) || (y.size_variant ?? 0) - (x.size_variant ?? 0));
  const description = renderMarkdown(a.description_md);
  const usage = renderMarkdown(a.usage_notes_md);
  const sectionLabel = section === "textures" ? "Textures" : "Assets";
  const telemetry = [
    ASSET_TYPE_LABEL[a.asset_type],
    a.triangle_count ? `${formatCount(a.triangle_count)} tris` : null,
    a.texture_size ? `${a.texture_size}px` : null,
    a.formats.length ? a.formats.join(" ").toUpperCase() : null,
    `v${a.version}`,
  ]
    .filter(Boolean)
    .join(" // ");
  const blocked = a.allows_download === false ? "Downloads are paused while this asset's licence is being confirmed." : null;
  const credit = a.attribution_required ? creditLine(data) : null;
  const tagHref = (t: { slug: string; facet: string }) =>
    `/${section}?${t.facet === "style" ? "style" : t.facet === "setting" ? "setting" : t.facet === "engine" ? "engine" : "tag"}=${encodeURIComponent(t.slug)}`;
  const bounds = a.bounds_mm?.length === 3 ? a.bounds_mm.map((v) => (v / 1000).toFixed(2)).join(" × ") : null;

  return (
    <Container wide>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd(data)).replace(/</g, "\\u003c") }} />
      <PageHeader
        title={a.title}
        description={a.short_description || undefined}
        telemetry={telemetry}
        breadcrumbs={[
          { label: "Home", href: "/" },
          { label: sectionLabel, href: `/${section}` },
          ...(a.category_slug ? [{ label: a.category_name!, href: `/${section}?category=${a.category_slug}` }] : []),
          { label: a.title },
        ]}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {a.is_demo ? <Badge title="Generated by LOWPO11Y for demonstration">Demo</Badge> : null}
            {a.licence_short ? <Badge tone="bright">{a.licence_short}</Badge> : null}
            {a.is_animated ? <Badge>Animated</Badge> : null}
            {a.is_rigged ? <Badge>Rigged</Badge> : null}
          </div>
        }
      />

      {/* DOM order (preview, details, aside) reads well; on phones the aside moves up under the preview. */}
      <div className="grid items-start gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_23rem] lg:grid-rows-[auto_1fr] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <section aria-label="Preview" className="min-w-0 lg:col-start-1 lg:row-start-1">
            {viewer?.kind === "model" ? (
              <ModelViewer src={viewer.src} poster={a.thumbnail_url} title={a.title} />
            ) : viewer?.kind === "texture" ? (
              <TextureViewer src={viewer.src} width={viewer.width} height={viewer.height} title={a.title} />
            ) : a.thumbnail_url ? (
              <img src={a.thumbnail_url} alt={`${a.title} preview`} className="aspect-[16/10] w-full border border-rule-strong bg-sunken object-contain" />
            ) : null}
        </section>

        <div className="order-3 flex min-w-0 flex-col gap-5 lg:order-none lg:col-start-1 lg:row-start-2">
          {description ? (
            <Panel title="About this asset">
              <Prose>
                <div dangerouslySetInnerHTML={{ __html: description }} />
              </Prose>
            </Panel>
          ) : null}
          {usage ? (
            <Panel title="Using it">
              <Prose>
                <div dangerouslySetInnerHTML={{ __html: usage }} />
              </Prose>
            </Panel>
          ) : null}
          {dependencies.length ? (
            <Panel title="Also needs">
              <ul className="flex flex-col gap-1">
                {dependencies.map((d) => (
                  <li key={d.slug}>
                    <Link href={assetPath(d)} className="text-bright underline underline-offset-4">
                      {d.title}
                    </Link>{" "}
                    <span className="text-xs text-muted">{ASSET_TYPE_LABEL[d.asset_type as keyof typeof ASSET_TYPE_LABEL] ?? d.asset_type}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>

        <aside aria-label="Download and licence" className="order-2 flex flex-col gap-4 lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1">
          <Panel title="Download">
            <DownloadPanel bundle={bundleFile ? toDownload(bundleFile) : null} files={deliveries.map(toDownload)} credit={credit} blocked={blocked} />
          </Panel>

          <Panel title="Licence" aside={a.licence_url ? <a href={a.licence_url} target="_blank" rel="noopener noreferrer" className="font-ocr text-[11px] tracking-[0.08em] text-muted uppercase hover:text-bright">[ Full text ]</a> : null}>
            <p className="mb-2 text-[14px] text-bright">{a.licence_label ?? "Licence not set"}</p>
            <ul>
              <Right label="Commercial use" value={a.commercial_use} />
              <Right label="Modify it" value={a.modifications} />
              <Right label="Credit required" value={a.attribution_required} />
              <Right label="Redistribute as-is" value={a.redistribution_allowed} />
              {a.share_alike ? <Right label="Share-alike" value={true} /> : null}
            </ul>
            {a.attribution_required ? (
              <div className="mt-3 flex flex-col gap-2">
                <p className="type-label">Credit line</p>
                <p className="border border-rule-strong bg-sunken px-2.5 py-2 text-[13px] text-fg">{creditLine(data)}</p>
                <div>
                  <CopyButton text={creditLine(data)} label="Copy credit" />
                </div>
              </div>
            ) : null}
            {a.licence_notes ? <p className="mt-3 text-xs leading-relaxed text-muted">{a.licence_notes}</p> : null}
            {a.provenance_kind ? (
              <p className="mt-3 text-xs leading-relaxed text-muted">
                <span className="text-fg">{PROVENANCE_LABEL[a.provenance_kind as keyof typeof PROVENANCE_LABEL] ?? a.provenance_kind}.</span>{" "}
                {a.provenance_notes}
                {a.licence_source_url ? (
                  <>
                    {" "}
                    <a href={a.licence_source_url} target="_blank" rel="noopener noreferrer nofollow" className="text-bright underline underline-offset-4">
                      Original source
                    </a>
                  </>
                ) : null}
              </p>
            ) : null}
            <p className="mt-3 text-xs text-muted">
              Found a problem with this asset&rsquo;s rights?{" "}
              <Link href={`/contact?topic=takedown&asset=${encodeURIComponent(a.slug)}`} className="text-bright underline underline-offset-4">
                Report it
              </Link>
              .
            </p>
          </Panel>

          <Panel title="Specs">
            <dl>
              <Spec label="Type">{ASSET_TYPE_LABEL[a.asset_type]}</Spec>
              {a.category_name ? (
                <Spec label="Category">
                  <Link href={`/${section}?category=${a.category_slug}`} className="hover:text-bright hover:underline">
                    {a.category_name}
                  </Link>
                </Spec>
              ) : null}
              {a.triangle_count ? <Spec label="Triangles">{formatCount(a.triangle_count)}</Spec> : null}
              {a.vertex_count ? <Spec label="Vertices">{formatCount(a.vertex_count)}</Spec> : null}
              {bounds ? <Spec label="Bounds">{bounds} units</Spec> : null}
              {a.texture_size ? <Spec label="Texture">{a.texture_size}px largest side</Spec> : null}
              {a.formats.length ? <Spec label="Formats">{a.formats.join(", ").toUpperCase()}</Spec> : null}
              {a.engines.length ? <Spec label="Tested in">{a.engines.map((e) => e[0]!.toUpperCase() + e.slice(1)).join(", ")}</Spec> : null}
              {creators.length ? (
                <Spec label="Made by">
                  {creators.map((c, i) => (
                    <span key={c.slug}>
                      {i > 0 ? ", " : null}
                      {c.url ? (
                        <a href={c.url} target="_blank" rel="noopener noreferrer" className="hover:text-bright hover:underline">
                          {c.name}
                        </a>
                      ) : (
                        c.name
                      )}
                    </span>
                  ))}
                </Spec>
              ) : null}
              <Spec label="Published">{formatDate(a.published_at)}</Spec>
              <Spec label="Updated">{formatDate(a.updated_at)}</Spec>
              <Spec label="Downloads">{formatCount(a.download_count)}</Spec>
            </dl>
          </Panel>

          {tags.length ? (
            <Panel title="Tags">
              <ul className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <li key={`${t.facet}-${t.slug}`}>
                    <Link href={tagHref(t)} className="inline-flex h-6 items-center border border-edge bg-sunken px-1.5 font-ocr text-[11px] tracking-[0.04em] text-muted hover:border-edge-hover hover:text-bright">
                      {t.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {collections.length ? (
            <Panel title="In collections">
              <ul className="flex flex-col gap-1">
                {collections.map((c) => (
                  <li key={c.slug}>
                    <Link href={`/collections/${c.slug}`} className="text-[13px] text-fg hover:text-bright hover:underline">
                      &gt; {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </aside>
      </div>

      {related.length ? (
        <section aria-labelledby="related-title" className="border-t border-rule-strong pt-5 pb-8">
          <h2 id="related-title" className="type-panel mb-3">
            // Related {a.asset_type === "texture" ? "textures" : "assets"}
          </h2>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
            {related.slice(0, 6).map((r) => (
              <li key={r.id} className="flex">
                <AssetCard item={r} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </Container>
  );
}
