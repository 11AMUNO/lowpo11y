import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Container, PageHeader } from "@/components/site/page-header";
import { difficultyLabel } from "@/features/content/cards";
import { VideoEmbed } from "@/features/content/video-embed";
import { getPublicTutorial } from "@/lib/content/public";
import { engineLabel } from "@/lib/content/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { absoluteUrl } from "@/lib/site";

export const dynamic = "force-dynamic";

const load = cache((slug: string) => withDb(PUBLIC, (q) => getPublicTutorial(q, slug)));

export async function generateMetadata({ params }: PageProps<"/learn/videos/[slug]">): Promise<Metadata> {
  const t = await load((await params).slug);
  if (!t) return { title: "Video not found", robots: { index: false } };
  return { title: t.title, description: t.summary, alternates: { canonical: `/learn/videos/${t.slug}` } };
}

export default async function VideoPage({ params }: PageProps<"/learn/videos/[slug]">) {
  const t = await load((await params).slug);
  if (!t) notFound();
  const watchUrl = t.youtube_video_id ? `https://www.youtube.com/watch?v=${t.youtube_video_id}` : t.external_url!;
  const facts: [string, string | null][] = [
    ["Topic", t.topic],
    ["Level", difficultyLabel(t.difficulty)],
    ["Engine", t.engine ? engineLabel(t.engine) : null],
    ["Length", t.duration_minutes ? `${t.duration_minutes} minutes` : null],
    ["Reviewed", formatDate(t.last_reviewed_at)],
  ];
  const jsonLd = t.youtube_video_id
    ? {
        "@context": "https://schema.org",
        "@type": "VideoObject",
        name: t.title,
        description: t.summary,
        embedUrl: `https://www.youtube-nocookie.com/embed/${t.youtube_video_id}`,
        url: absoluteUrl(`/learn/videos/${t.slug}`),
        creator: { "@type": "Person", name: t.creator_name },
      }
    : null;

  return (
    <Container wide>
      {jsonLd ? <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} /> : null}
      <PageHeader
        title={t.title}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Learn", href: "/learn" }, { label: t.title }]}
        telemetry={
          <>
            by{" "}
            <Link href={`/learn/creators/${t.creator_slug}`} className="text-bright underline underline-offset-4">
              {t.creator_name}
            </Link>
          </>
        }
      />
      <div className="grid items-start gap-5 py-5 lg:grid-cols-[minmax(0,1fr)_23rem] xl:grid-cols-[minmax(0,1fr)_25rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {t.youtube_video_id ? (
            <VideoEmbed videoId={t.youtube_video_id} title={t.title} watchUrl={watchUrl} />
          ) : (
            <Panel title="Watch">
              <a href={watchUrl} target="_blank" rel="noopener noreferrer" className={buttonClasses("primary", "lg")}>
                Open the video on {new URL(watchUrl).hostname.replace(/^www\./, "")}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </Panel>
          )}
          <Panel title="What you'll learn">
            <p className="max-w-[70ch] text-[15px] leading-relaxed text-fg/90">{t.summary}</p>
          </Panel>
        </div>
        <aside aria-label="About this video" className="flex flex-col gap-4">
          <Panel title="Details">
            <dl className="grid grid-cols-[6.5rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
              {facts
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-muted">{k}</dt>
                    <dd className="text-fg">{v}</dd>
                  </div>
                ))}
            </dl>
          </Panel>
          <Panel title="Creator">
            <p className="text-[14px] text-fg">{t.creator_name}</p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{t.creator_description}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href={`/learn/creators/${t.creator_slug}`} className={buttonClasses("secondary", "sm")}>
                More from {t.creator_name}
              </Link>
              {t.creator_channel_url ? (
                <a href={t.creator_channel_url} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "sm")}>
                  Channel<span className="sr-only"> (opens in a new tab)</span>
                </a>
              ) : null}
            </div>
          </Panel>
          <p className="px-1 text-xs leading-relaxed text-muted">
            This is a third-party video. The summary is ours; the video belongs to {t.creator_name}.{" "}
            <a href={watchUrl} target="_blank" rel="noopener noreferrer" className="text-bright underline underline-offset-4">
              Watch it at the source
            </a>
          </p>
        </aside>
      </div>
    </Container>
  );
}
