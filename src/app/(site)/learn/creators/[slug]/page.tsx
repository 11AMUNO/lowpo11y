import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { buttonClasses } from "@/components/ui/button";
import { Container, PageHeader } from "@/components/site/page-header";
import { TutorialCardView } from "@/features/content/cards";
import { getPublicCreator, listPublicTutorials } from "@/lib/content/public";
import { PUBLIC, withDb } from "@/lib/db";
import { formatDate, pluralise } from "@/lib/format";

export const dynamic = "force-dynamic";

const load = cache((slug: string) =>
  withDb(PUBLIC, async (q) => {
    const creator = await getPublicCreator(q, slug);
    return creator ? { creator, videos: await listPublicTutorials(q, {}, creator.id) } : null;
  }),
);

export async function generateMetadata({ params }: PageProps<"/learn/creators/[slug]">): Promise<Metadata> {
  const data = await load((await params).slug);
  if (!data) return { title: "Creator not found", robots: { index: false } };
  return { title: data.creator.name, description: data.creator.description, alternates: { canonical: `/learn/creators/${data.creator.slug}` } };
}

export default async function CreatorPage({ params }: PageProps<"/learn/creators/[slug]">) {
  const data = await load((await params).slug);
  if (!data) notFound();
  const { creator: c, videos } = data;
  return (
    <Container wide>
      <PageHeader
        title={c.name}
        description={c.description}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Learn", href: "/learn" }, { label: "Creators", href: "/learn/creators" }, { label: c.name }]}
        telemetry={[c.categories.join(", ") || null, `reviewed ${formatDate(c.last_reviewed_at)}`].filter(Boolean).join(" // ")}
        actions={
          <>
            {c.youtube_channel_url ? (
              <a href={c.youtube_channel_url} target="_blank" rel="noopener noreferrer" className={buttonClasses("primary", "md")}>
                YouTube channel<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
            {c.website_url ? (
              <a href={c.website_url} target="_blank" rel="noopener noreferrer" className={buttonClasses("secondary", "md")}>
                Website<span className="sr-only"> (opens in a new tab)</span>
              </a>
            ) : null}
          </>
        }
      />
      <section aria-labelledby="videos-title" className="py-6">
        <h2 id="videos-title" className="type-panel mb-3">
          // {videos.length ? pluralise(videos.length, "listed video") : "Videos"}
        </h2>
        {videos.length ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {videos.map((t) => (
              <li key={t.id} className="flex">
                <TutorialCardView t={t} showCreator={false} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-muted">We haven&apos;t listed individual videos from {c.name} yet. Their channel is worth browsing.</p>
        )}
        <p className="mt-6 max-w-[70ch] text-xs leading-relaxed text-muted">
          {c.name} isn&apos;t affiliated with LOWPO11Y. We link to their work because we think it&apos;s useful; the videos and channel are theirs.
        </p>
      </section>
    </Container>
  );
}
