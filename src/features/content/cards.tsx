import Link from "next/link";
import { cn } from "@/lib/cn";
import { testedLine } from "@/lib/content/bundles";
import type { CreatorCard, ResourceCard, ShaderCard, StarterCard, TutorialCard } from "@/lib/content/public";
import { CODE_LANGUAGES, engineLabel } from "@/lib/content/schemas";
import { formatBytes, formatDate, pluralise } from "@/lib/format";

const cardClass = "group flex w-full flex-col border border-rule-strong bg-panel transition-[border-color] hover:border-edge-hover focus-visible:border-bright";
const titleClass = "text-[14.5px] leading-snug text-fg group-hover:text-bright group-hover:[text-shadow:var(--crt-glow)]";
const metaClass = "font-ocr text-[11px] tracking-[0.06em] text-muted uppercase";

export const languageLabel = (id: string | null) => CODE_LANGUAGES.find((c) => c.id === id)?.label ?? null;

export function ShaderCardView({ s }: { s: ShaderCard }) {
  return (
    <Link href={`/shaders/${s.slug}`} className={cardClass}>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className={metaClass}>
          {engineLabel(s.engine)}
          {languageLabel(s.code_language) ? ` // ${languageLabel(s.code_language)}` : ""}
          {s.featured ? " // featured" : ""}
        </p>
        <h3 className={titleClass}>{s.title}</h3>
        {s.summary ? <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{s.summary}</p> : null}
        {s.tags.length ? <p className="text-xs text-muted">{s.tags.slice(0, 5).join(", ")}</p> : null}
        <p className="mt-auto border-t border-dashed border-rule-strong pt-2 text-xs leading-relaxed text-fg/85">{testedLine(s)}</p>
        <p className={metaClass}>{s.licence_short ?? "Licence unknown"}</p>
      </div>
    </Link>
  );
}

export function StarterCardView({ p }: { p: StarterCard }) {
  return (
    <Link href={`/starter-projects/${p.slug}`} className={cardClass}>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className={metaClass}>
          {engineLabel(p.engine)}
          {p.engine_versions ? ` ${p.engine_versions}` : ""}
          {p.featured ? " // featured" : ""}
        </p>
        <h3 className={titleClass}>{p.title}</h3>
        {p.summary ? <p className="line-clamp-2 text-[13px] leading-relaxed text-muted">{p.summary}</p> : null}
        {p.included_features.length ? (
          <ul className="flex flex-col gap-0.5 text-xs text-fg/85">
            {p.included_features.slice(0, 4).map((f) => (
              <li key={f}>&gt; {f}</li>
            ))}
            {p.included_features.length > 4 ? <li className="text-muted">+ {p.included_features.length - 4} more</li> : null}
          </ul>
        ) : null}
        <p className={cn(metaClass, "mt-auto border-t border-dashed border-rule-strong pt-2")}>
          Tested {formatDate(p.tested_at)}
          {p.file_size_bytes ? ` // ZIP ${formatBytes(p.file_size_bytes)}` : ""}
          {p.licence_short ? ` // ${p.licence_short}` : ""}
        </p>
      </div>
    </Link>
  );
}

const DIFFICULTY_LABEL = { beginner: "Beginner", intermediate: "Intermediate", advanced: "Advanced" } as const;
export const difficultyLabel = (d: string | null) => (d ? (DIFFICULTY_LABEL[d as keyof typeof DIFFICULTY_LABEL] ?? d) : null);

export function TutorialCardView({ t, showCreator = true }: { t: TutorialCard; showCreator?: boolean }) {
  return (
    <Link href={`/learn/videos/${t.slug}`} className={cardClass}>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <p className={metaClass}>
          {[t.youtube_video_id ? "Video" : "Link", t.duration_minutes ? `${t.duration_minutes} min` : null, difficultyLabel(t.difficulty), t.engine ? engineLabel(t.engine) : null, t.featured ? "Featured" : null]
            .filter(Boolean)
            .join(" // ")}
        </p>
        <h3 className={titleClass}>{t.title}</h3>
        {showCreator ? <p className="text-xs text-fg/85">by {t.creator_name}</p> : null}
        {t.summary ? <p className="line-clamp-3 text-[13px] leading-relaxed text-muted">{t.summary}</p> : null}
        <p className={cn(metaClass, "mt-auto border-t border-dashed border-rule-strong pt-2")}>
          {t.topic ?? "General"} // reviewed {formatDate(t.last_reviewed_at)}
        </p>
      </div>
    </Link>
  );
}

export function CreatorCardView({ c }: { c: CreatorCard }) {
  return (
    <Link href={`/learn/creators/${c.slug}`} className={cardClass}>
      <div className="flex flex-1 flex-col gap-2 p-3.5">
        <h3 className={titleClass}>{c.name}</h3>
        <p className="line-clamp-3 text-[13px] leading-relaxed text-muted">{c.description}</p>
        {c.categories.length ? <p className="text-xs text-fg/85">{c.categories.join(", ")}</p> : null}
        <p className={cn(metaClass, "mt-auto border-t border-dashed border-rule-strong pt-2")}>
          {c.video_count ? pluralise(c.video_count, "listed video") : "Channel only"} // reviewed {formatDate(c.last_reviewed_at)}
        </p>
      </div>
    </Link>
  );
}

export function ResourceRow({ r }: { r: ResourceCard }) {
  const host = new URL(r.url).hostname.replace(/^www\./, "");
  return (
    <li id={r.slug} className="scroll-mt-24 border-b border-dashed border-rule-strong py-3 last:border-0 target:bg-hover">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-[14.5px] leading-snug">
          <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-fg underline-offset-4 hover:text-bright hover:underline">
            {r.title}
            <span className="sr-only"> (opens {host} in a new tab)</span>
          </a>
          {r.featured ? <span className="ml-2 font-ocr text-[11px] tracking-[0.06em] text-bright uppercase">Featured</span> : null}
        </h3>
        <span className={metaClass}>{host}</span>
      </div>
      {r.description ? <p className="mt-1 max-w-[75ch] text-[13px] leading-relaxed text-fg/85">{r.description}</p> : null}
      <p className="mt-1 text-xs text-muted">
        {r.licence_note ? `${r.licence_note} // ` : ""}reviewed {formatDate(r.last_reviewed_at)}
      </p>
    </li>
  );
}

/** A row of filter links, each with a count; the active one is marked. */
export function FilterChips({ label, items }: { label: string; items: { label: string; href: string; active: boolean; count?: number }[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 font-ocr text-[11px] tracking-[0.08em] text-muted uppercase">{label}</span>
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          scroll={false}
          aria-current={i.active ? "true" : undefined}
          className={cn(
            "flex h-7 items-center gap-1.5 border border-edge bg-sunken px-2 font-ocr text-[11.5px] tracking-[0.05em] text-muted uppercase hover:border-edge-hover hover:text-bright",
            i.active && "border-bright text-bright [text-shadow:var(--crt-glow)]",
          )}
        >
          {i.label}
          {i.count !== undefined ? <span className="text-[10.5px] text-muted">{i.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
