"use client";

import { Dialog as RDialog } from "radix-ui";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { SearchResult } from "@/lib/search/types";
import { buildStaticIndex, searchStatic } from "./search-index";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  page: "PAGE",
  tool: "TOOL",
  asset: "ASSET",
  texture: "TEXTURE",
  collection: "COLLECTION",
  shader: "SHADER",
  starter: "STARTER",
  tutorial: "VIDEO",
  creator: "CREATOR",
  resource: "RESOURCE",
};

const STATIC_INDEX = buildStaticIndex();

export function SearchCommand({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remote, setRemote] = useState<{ q: string; results: SearchResult[] }>({ q: "", results: [] });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const router = useRouter();
  const listId = useId();
  const listRef = useRef<HTMLUListElement>(null);

  // Global shortcut: Cmd/Ctrl+K, or "/" when not typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable=true]");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Debounced catalogue search.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        if (res.ok) setRemote({ q, results: ((await res.json()) as { results: SearchResult[] }).results });
      } catch {
        // Aborted or offline — static results still show.
      } finally {
        if (!ctrl.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const results = useMemo(() => {
    const q = query.trim();
    const local = q ? searchStatic(STATIC_INDEX, q) : STATIC_INDEX.filter((r) => r.kind === "page").slice(0, 7);
    // Only show catalogue results that belong to the current query.
    const catalogue = q.length >= 2 && remote.q === q ? remote.results : [];
    const seen = new Set<string>();
    return [...catalogue, ...local].filter((r) => (seen.has(r.href) ? false : (seen.add(r.href), true))).slice(0, 20);
  }, [query, remote]);

  const go = useCallback(
    (r: SearchResult | undefined) => {
      if (!r) return;
      setOpen(false);
      setQuery("");
      router.push(r.href);
    },
    [router],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      go(results[active]);
    }
  };

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <RDialog.Root open={open} onOpenChange={setOpen}>
      <RDialog.Trigger
        className={cn(
          "flex h-8 cursor-pointer items-center gap-3 border border-edge bg-sunken px-2.5 font-ocr text-xs tracking-[0.08em] text-muted uppercase transition-colors hover:border-edge-hover hover:text-bright",
          className,
        )}
      >
        <span>&gt; Search</span>
        <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
      </RDialog.Trigger>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <RDialog.Content
          className="fixed top-[9dvh] left-1/2 z-50 flex max-h-[76dvh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden border border-bright bg-panel shadow-[var(--crt-glow)] focus:outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <RDialog.Title className="sr-only">Search LOWPO11Y</RDialog.Title>
          <RDialog.Description className="sr-only">
            Search assets, textures, tools and pages. Use the arrow keys to move and Enter to open.
          </RDialog.Description>
          <div className="flex items-center gap-2 border-b border-dashed border-rule-strong px-3">
            <span aria-hidden className="font-ocr text-muted">
              &gt;
            </span>
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              aria-label="Search"
              placeholder="search assets, textures, tools…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-12 flex-1 bg-transparent text-[15px] text-bright caret-white outline-none placeholder:text-faint"
            />
            {loading ? <span className="font-ocr text-[11px] tracking-[0.08em] text-muted">SEARCHING…</span> : null}
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="lp-scroll min-h-0 flex-1 overflow-y-auto py-1">
            {results.length === 0 ? (
              <li className="px-4 py-8 font-ocr text-xs tracking-[0.06em] text-muted uppercase">
                &gt; No matches for “{query.trim()}” // try a material (rust), an object (crate) or a tool (atlas)
              </li>
            ) : (
              results.map((r, i) => (
                <li
                  key={r.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-index={i}
                  onMouseMove={() => setActive(i)}
                  onClick={() => go(r)}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 border-l-2 px-3 py-1.5",
                    i === active ? "border-bright bg-hover" : "border-transparent",
                  )}
                >
                  {r.thumbnail ? (
                    <img src={r.thumbnail} alt="" width={36} height={36} className="size-9 shrink-0 border border-rule-strong bg-sunken object-cover pixelated" />
                  ) : null}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-[13px]", i === active ? "glow" : "text-fg")}>{r.title}</span>
                    {r.subtitle ? <span className="block truncate text-xs text-muted">{r.subtitle}</span> : null}
                  </span>
                  <span className="shrink-0 font-ocr text-[11px] tracking-[0.06em] text-muted">{KIND_LABEL[r.kind]}</span>
                </li>
              ))
            )}
          </ul>
          <div className="flex items-center gap-4 border-t border-dashed border-rule-strong px-3 py-2 font-ocr text-[11px] tracking-[0.06em] text-muted uppercase">
            <span className="flex items-center gap-1.5">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>↵</Kbd> open
            </span>
            <span className="flex items-center gap-1.5">
              <Kbd>esc</Kbd> close
            </span>
          </div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
