"use client";

import { Dialog as RDialog } from "radix-ui";
import { Box, Code2, CornerDownLeft, FileText, FolderOpen, Image as ImageIcon, Layers, PlayCircle, Search, User, Wrench, type LucideIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { TOOLS } from "@/features/tools/registry";
import type { SearchResult } from "@/lib/search/types";
import { PRIMARY_NAV, FOOTER_NAV } from "./nav";

const KIND_LABEL: Record<SearchResult["kind"], string> = {
  page: "Page",
  tool: "Tool",
  asset: "Asset",
  texture: "Texture",
  collection: "Collection",
  shader: "Shader",
  starter: "Starter project",
  tutorial: "Tutorial",
  creator: "Creator",
};

const KIND_ICON: Record<SearchResult["kind"], LucideIcon> = {
  page: FileText,
  tool: Wrench,
  asset: Box,
  texture: ImageIcon,
  collection: Layers,
  shader: Code2,
  starter: FolderOpen,
  tutorial: PlayCircle,
  creator: User,
};

function buildStaticIndex(): SearchResult[] {
  const pages = new Map<string, SearchResult>();
  for (const n of PRIMARY_NAV) pages.set(n.href, { id: `page:${n.href}`, kind: "page", title: n.label, subtitle: n.description, href: n.href });
  for (const group of FOOTER_NAV)
    for (const n of group.items)
      if (!pages.has(n.href)) pages.set(n.href, { id: `page:${n.href}`, kind: "page", title: n.label, href: n.href });
  const tools: SearchResult[] = TOOLS.filter((t) => t.status === "available").map((t) => ({
    id: `tool:${t.slug}`,
    kind: "tool",
    title: t.name,
    subtitle: t.summary,
    href: t.route,
  }));
  return [...tools, ...pages.values()];
}

const STATIC_INDEX = buildStaticIndex();

function matchesQuery(r: SearchResult, q: string) {
  const hay = `${r.title} ${r.subtitle ?? ""}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

function KindIcon({ kind }: { kind: SearchResult["kind"] }) {
  const Icon = KIND_ICON[kind];
  return (
    <span className="grid size-9 shrink-0 place-items-center rounded-xs border border-rule bg-sunken text-muted">
      <Icon className="size-4" aria-hidden />
    </span>
  );
}

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
    const local = q ? STATIC_INDEX.filter((r) => matchesQuery(r, q)) : STATIC_INDEX.filter((r) => r.kind === "page").slice(0, 7);
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
          "flex h-8 items-center gap-2 rounded-sm border border-rule-strong bg-sunken pr-1.5 pl-2.5 text-[0.8125rem] text-muted transition-colors hover:border-fg/35 hover:text-fg",
          className,
        )}
      >
        <Search className="size-3.5" aria-hidden />
        <span className="hidden sm:inline">Search</span>
        <span className="sr-only sm:hidden">Search</span>
        <Kbd className="ml-4 hidden sm:inline-flex">⌘K</Kbd>
      </RDialog.Trigger>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-scrim" />
        <RDialog.Content
          className="fixed top-[9dvh] left-1/2 z-50 flex max-h-[76dvh] w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 flex-col overflow-hidden rounded-lg border border-rule-strong bg-panel focus:outline-none"
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).querySelector("input")?.focus();
          }}
        >
          <RDialog.Title className="sr-only">Search LOWPO11Y</RDialog.Title>
          <RDialog.Description className="sr-only">
            Search assets, textures, tools and pages. Use the arrow keys to move and Enter to open.
          </RDialog.Description>
          <div className="flex items-center gap-3 border-b border-rule px-4">
            <Search className="size-4 shrink-0 text-muted" aria-hidden />
            <input
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
              aria-autocomplete="list"
              aria-label="Search"
              placeholder="Search assets, textures, tools…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              className="h-14 flex-1 bg-transparent text-base text-fg outline-none placeholder:text-faint"
            />
            {loading ? <span className="type-small text-muted">Searching…</span> : null}
          </div>
          <ul ref={listRef} id={listId} role="listbox" aria-label="Results" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <li className="px-3 py-8 text-center text-muted">
                No matches for “{query.trim()}”. Try a material (“rust”), an object (“crate”) or a tool (“atlas”).
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
                    "flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2",
                    i === active ? "bg-panel-2" : undefined,
                  )}
                >
                  {r.thumbnail ? (
                    <img src={r.thumbnail} alt="" width={36} height={36} className="size-9 shrink-0 rounded-xs bg-sunken object-cover pixelated" />
                  ) : (
                    <KindIcon kind={r.kind} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{r.title}</span>
                    {r.subtitle ? <span className="type-small block truncate text-muted">{r.subtitle}</span> : null}
                  </span>
                  <span className="type-small shrink-0 text-muted">{KIND_LABEL[r.kind]}</span>
                  {i === active ? <CornerDownLeft className="size-3.5 shrink-0 text-muted" aria-hidden /> : null}
                </li>
              ))
            )}
          </ul>
          <div className="type-small flex items-center gap-4 border-t border-rule px-4 py-2 text-muted">
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
