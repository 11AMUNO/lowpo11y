import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/site/page-header";
import { difficultyLabel, FilterChips, TutorialCardView } from "@/features/content/cards";
import { learnFacets, learnFilterSchema, listPublicTutorials, type LearnFilters } from "@/lib/content/public";
import { DIFFICULTIES, ENGINES, TOPICS, engineLabel } from "@/lib/content/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { pluralise } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Learn",
  description: "Hand-picked videos on low-poly modelling, texturing, retro rendering and engine setup, each linked to the creator who made it.",
  alternates: { canonical: "/learn" },
};

function qs(f: LearnFilters, patch: Partial<LearnFilters>) {
  const next = { ...f, ...patch };
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(next)) if (v) s.set(k, v);
  return `/learn${s.size ? `?${s}` : ""}`;
}

export default async function LearnPage({ searchParams }: PageProps<"/learn">) {
  const raw = await searchParams;
  const one = (k: string) => (Array.isArray(raw[k]) ? raw[k][0] : raw[k]);
  const f = learnFilterSchema.parse({ topic: one("topic"), difficulty: one("difficulty"), engine: one("engine"), featured: one("featured"), q: one("q") });
  const filtered = !!(f.topic || f.difficulty || f.engine || f.featured || f.q);
  const { videos, facets } = await withDb(PUBLIC, async (q) => ({ videos: await listPublicTutorials(q, f), facets: await learnFacets(q) }));

  return (
    <Container wide>
      <PageHeader
        title="Learn"
        description="Videos we've watched and recommend on low-poly modelling, texturing, retro rendering and engine setup. Each one has a short note on what you'll learn. They're made by independent creators; we link to them and never rehost their work."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Learn" }]}
        telemetry={`${pluralise(facets.total, "video")}${filtered ? ` // ${videos.length} shown` : ""}`}
        actions={
          <>
            <Link href="/learn/creators" className={buttonClasses("secondary", "md")}>
              Creators
            </Link>
            <Link href="/resources" className={buttonClasses("secondary", "md")}>
              Resources
            </Link>
          </>
        }
      />
      {facets.total ? (
        <div className="flex flex-col gap-2.5 pt-5">
          <FilterChips
            label="Topic"
            items={[
              { label: "All", href: qs(f, { topic: undefined }), active: !f.topic },
              ...TOPICS.filter((t) => facets.topic[t]).map((t) => ({ label: t, href: qs(f, { topic: f.topic === t ? undefined : t }), active: f.topic === t, count: facets.topic[t] })),
            ]}
          />
          <div className="flex flex-wrap gap-x-6 gap-y-2.5">
            {Object.keys(facets.difficulty).length ? (
              <FilterChips
                label="Level"
                items={DIFFICULTIES.filter((d) => facets.difficulty[d]).map((d) => ({ label: difficultyLabel(d)!, href: qs(f, { difficulty: f.difficulty === d ? undefined : d }), active: f.difficulty === d, count: facets.difficulty[d] }))}
              />
            ) : null}
            {Object.keys(facets.engine).length ? (
              <FilterChips
                label="Engine"
                items={ENGINES.filter((e) => facets.engine[e.id]).map((e) => ({ label: engineLabel(e.id), href: qs(f, { engine: f.engine === e.id ? undefined : e.id }), active: f.engine === e.id, count: facets.engine[e.id] }))}
              />
            ) : null}
            {facets.featured ? <FilterChips label="Picks" items={[{ label: "Featured", href: qs(f, { featured: f.featured ? undefined : "1" }), active: !!f.featured, count: facets.featured }]} /> : null}
          </div>
          <form method="get" role="search" className="flex max-w-xl gap-2">
            {(["topic", "difficulty", "engine", "featured"] as const).map((k) => (f[k] ? <input key={k} type="hidden" name={k} value={f[k]} /> : null))}
            <label htmlFor="learn-q" className="sr-only">
              Search videos
            </label>
            <input
              id="learn-q"
              name="q"
              type="search"
              defaultValue={f.q ?? ""}
              placeholder="UV unwrapping, fog, Godot…"
              className="h-9 min-w-0 flex-1 border border-edge-strong bg-sunken px-2.5 text-[13.5px] text-bright outline-none placeholder:text-muted focus-visible:border-bright"
            />
            <button type="submit" className={buttonClasses("secondary", "md")}>
              Search
            </button>
          </form>
        </div>
      ) : null}
      <div className="py-5">
        {videos.length ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {videos.map((t) => (
              <li key={t.id} className="flex">
                <TutorialCardView t={t} />
              </li>
            ))}
          </ul>
        ) : filtered ? (
          <EmptyState
            title="No videos match"
            action={
              <Link href="/learn" className={buttonClasses("secondary", "md")}>
                Clear filters
              </Link>
            }
          >
            <p>Try another topic or level, or search for a different word.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="The video directory is being curated"
            action={
              <Link href="/resources" className={buttonClasses("secondary", "md")}>
                Resources
              </Link>
            }
          >
            <p>Every video is watched before it&apos;s listed, with a note on what you&apos;ll learn and which engine it uses.</p>
          </EmptyState>
        )}
      </div>
    </Container>
  );
}
