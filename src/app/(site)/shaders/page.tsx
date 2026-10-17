import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Container, PageHeader } from "@/components/site/page-header";
import { FilterChips, ShaderCardView } from "@/features/content/cards";
import { listPublicShaders, shaderFilterSchema } from "@/lib/content/public";
import { engineLabel } from "@/lib/content/schemas";
import { PUBLIC, withDb } from "@/lib/db";
import { pluralise } from "@/lib/format";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Shaders & Code",
  description: "Retro-style shaders and scripts for three.js, Godot and more, each listed with the engine version it was tested on, setup steps and limitations.",
  alternates: { canonical: "/shaders" },
};

export default async function ShadersPage({ searchParams }: PageProps<"/shaders">) {
  const raw = await searchParams;
  const f = shaderFilterSchema.parse({ engine: raw.engine, q: raw.q });
  const { all, shown } = await withDb(PUBLIC, async (q) => {
    const all = await listPublicShaders(q);
    return { all, shown: f.engine || f.q ? await listPublicShaders(q, f) : all };
  });
  const engines = [...new Set(all.map((s) => s.engine))];
  const href = (engine?: string) => {
    const s = new URLSearchParams();
    if (engine) s.set("engine", engine);
    if (f.q) s.set("q", f.q);
    return `/shaders${s.size ? `?${s}` : ""}`;
  };

  return (
    <Container wide>
      <PageHeader
        title="Shaders & Code"
        description="Retro-style shaders and scripts, each tested before it's listed. Every entry says which engine and version it ran on, how to set it up and where it falls short. Downloads include a README and the licence."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Shaders & Code" }]}
        telemetry={`${pluralise(all.length, "entry", "entries")}${engines.length ? ` // ${engines.map(engineLabel).join(", ")}` : ""}`}
        actions={
          <Link href="/starter-projects" className={buttonClasses("secondary", "md")}>
            Starter projects
          </Link>
        }
      />
      {all.length ? (
        <div className="flex flex-col gap-3 pt-5">
          {engines.length > 1 ? (
            <FilterChips
              label="Engine"
              items={[{ label: "All", href: href(), active: !f.engine, count: all.length }, ...engines.map((e) => ({ label: engineLabel(e), href: href(e), active: f.engine === e, count: all.filter((s) => s.engine === e).length }))]}
            />
          ) : null}
          <form method="get" role="search" className="flex max-w-xl gap-2">
            {f.engine ? <input type="hidden" name="engine" value={f.engine} /> : null}
            <label htmlFor="shader-q" className="sr-only">
              Search shaders
            </label>
            <input
              id="shader-q"
              name="q"
              type="search"
              defaultValue={f.q ?? ""}
              placeholder="fog, dither, vertex snap…"
              className="h-9 min-w-0 flex-1 border border-edge-strong bg-sunken px-2.5 text-[13.5px] text-bright outline-none placeholder:text-muted focus-visible:border-bright"
            />
            <button type="submit" className={buttonClasses("secondary", "md")}>
              Search
            </button>
          </form>
        </div>
      ) : null}
      <div className="py-5">
        {shown.length ? (
          <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => (
              <li key={s.id} className="flex">
                <ShaderCardView s={s} />
              </li>
            ))}
          </ul>
        ) : all.length ? (
          <EmptyState
            title="Nothing matches"
            action={
              <Link href="/shaders" className={buttonClasses("secondary", "md")}>
                Show all shaders
              </Link>
            }
          >
            <p>Try another word, or clear the engine filter.</p>
          </EmptyState>
        ) : (
          <EmptyState
            title="Shaders are being tested"
            action={
              <Link href="/starter-projects" className={buttonClasses("secondary", "md")}>
                Starter projects
              </Link>
            }
          >
            <p>Every entry is run in its engine before it&apos;s listed, so this page stays empty until that testing is done.</p>
          </EmptyState>
        )}
      </div>
    </Container>
  );
}
