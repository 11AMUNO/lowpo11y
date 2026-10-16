import type { Metadata } from "next";
import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { Banner } from "@/components/site/logo";
import { Container } from "@/components/site/page-header";
import { TexturePage, type TexturePageTile } from "@/components/site/texture-page";
import { DEMO_TEXTURES } from "@/lib/demo/textures";
import { TOOLS } from "@/features/tools/registry";
import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: { absolute: `${site.name}: free low-poly assets and retro texture tools` },
  alternates: { canonical: "/" },
};

const PIPELINE = [
  { n: "01", step: "Find", text: "Search models and textures by style, setting, size and licence." },
  { n: "02", step: "Inspect", text: "Orbit the model, check triangle counts, read the texture at native resolution." },
  { n: "03", step: "Process", text: "Resize, dither, tile, recolour or pack into an atlas, on your machine." },
  { n: "04", step: "Export", text: "Download PNG, GLB and a manifest with exact sizes and licence notes." },
  { n: "05", step: "Use it", text: "Import into Godot, Blender or Unity with settings that keep pixels crisp." },
];

export default function HomePage() {
  const tiles: TexturePageTile[] = DEMO_TEXTURES.slice(0, 12).map((t) => ({
    src: `/demo/textures/${t.slug}.png`,
    title: t.title,
    size: 128,
    alpha: t.hasAlpha,
  }));
  while (tiles.length % 4 !== 0) tiles.push({ src: null, title: "free slot", size: 128 });
  const ready = TOOLS.filter((t) => t.status === "available").length;

  return (
    <Container wide>
      <section className="pt-8 pb-6">
        <h1 className="sr-only">LOWPO11Y: free low-poly assets and the tools to make your own</h1>
        <Banner />
        <p className="mt-4 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">
          &gt; <b className="font-normal glow">Low-poly asset terminal</b> // v0.1 // free assets + local tools // files never leave this machine
          <span className="lp-cursor" aria-hidden />
        </p>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-1 font-ocr text-[13px] tracking-[0.06em] text-muted uppercase">
          <li>
            Textures: <strong className="font-normal glow">{DEMO_TEXTURES.length}</strong>
          </li>
          <li>
            Models: <strong className="font-normal glow">0</strong>
          </li>
          <li>
            Tools ready: <strong className="font-normal glow">{ready}</strong>/{TOOLS.length}
          </li>
          <li>
            Licence shown: <strong className="font-normal glow">always</strong>
          </li>
        </ul>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,36rem)]">
        <div className="flex flex-col gap-4">
          <Panel title="Search the library" labelledBy="home-search-title">
            <p className="mb-3 text-[15px] leading-relaxed text-fg/90">
              Free low-poly models and textures with clear licences, plus browser tools to resize, dither, tile and pack
              them. Nothing you open in a tool is uploaded.
            </p>
            <form action="/assets" method="get" role="search" className="flex gap-2">
              <label htmlFor="home-search" className="sr-only">
                Search the library
              </label>
              <div className="flex flex-1 items-center border border-edge-strong bg-sunken focus-within:border-bright focus-within:shadow-[var(--crt-glow)] hover:border-edge-hover">
                <span aria-hidden className="px-2 font-ocr text-muted">
                  &gt;
                </span>
                <input
                  id="home-search"
                  name="q"
                  type="search"
                  placeholder="crate, rusted metal, crt…"
                  className="h-10 min-w-0 flex-1 bg-transparent pr-2 text-[14px] text-bright caret-white outline-none placeholder:text-faint"
                />
              </div>
              <button type="submit" className={buttonClasses("primary", "lg")}>
                [ Search ]
              </button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/textures" className={buttonClasses("secondary", "md")}>
                Browse textures
              </Link>
              <Link href="/assets" className={buttonClasses("secondary", "md")}>
                Browse models
              </Link>
              <Link href="/tools" className={buttonClasses("secondary", "md")}>
                Open tools
              </Link>
              <Link href="/scene-builder" className={buttonClasses("secondary", "md")}>
                Scene builder
              </Link>
            </div>
          </Panel>

          <Panel title={<>Pipeline <span className="tracking-[0.06em] text-muted normal-case">library → engine</span></>}>
            <ol>
              {PIPELINE.map((p) => (
                <li key={p.n} className="mb-2 flex items-baseline gap-3 border border-rule-strong bg-sunken px-2.5 py-2 last:mb-0">
                  <span aria-hidden className="font-ocr text-[13px] tracking-[0.1em] text-faint">
                    {p.n}
                  </span>
                  <span className="w-20 shrink-0 font-ocr text-[13px] tracking-[0.1em] uppercase glow">{p.step}</span>
                  <span className="text-[13px] text-muted">{p.text}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <Panel title="Texture page">
          <TexturePage tiles={tiles} columns={4} cell={128} label="TPAGE 0" className="w-full" />
          <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted">
            Demo textures generated by LOWPO11Y for testing // CC0
          </p>
        </Panel>
      </div>

      <Panel title={<>Tools <span className="tracking-[0.06em] text-muted normal-case">run on your machine</span></>} className="mt-4" aside={<Link href="/tools" className="font-ocr text-xs tracking-[0.08em] text-muted uppercase hover:text-bright">[ All tools ]</Link>}>
        <ul className="grid gap-x-6 md:grid-cols-2">
          {TOOLS.map((t) => (
            <li key={t.slug} className="flex items-baseline justify-between gap-4 border-b border-dashed border-rule-strong py-2.5">
              <div className="min-w-0">
                {t.status === "available" ? (
                  <Link href={t.route} className="font-ocr text-[13px] tracking-[0.08em] uppercase glow hover:underline">
                    {t.name}
                  </Link>
                ) : (
                  <span className="font-ocr text-[13px] tracking-[0.08em] text-fg uppercase">{t.name}</span>
                )}
                <p className="mt-0.5 text-xs text-muted">{t.summary}</p>
              </div>
              <span className="shrink-0 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">{t.status === "available" ? "Ready" : "In dev"}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </Container>
  );
}
