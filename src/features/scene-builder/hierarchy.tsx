"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { SceneDoc, SceneNode } from "@/lib/scene/schema";
import type { AssetState } from "./runtime";

const KIND = { group: "GRP", model: "MDL", primitive: "BLK" } as const;

export function Hierarchy({
  doc,
  selection,
  assets,
  onSelect,
  onToggle,
}: {
  doc: SceneDoc;
  selection: string[];
  assets: Map<string, AssetState>;
  onSelect: (id: string, mode: "replace" | "toggle" | "range") => void;
  onToggle: (id: string, key: "visible" | "locked") => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const kids = new Map<string | null, SceneNode[]>();
  for (const n of doc.nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n]);
  const rows: { node: SceneNode; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const n of kids.get(parent) ?? []) {
      rows.push({ node: n, depth });
      if (!collapsed.has(n.id)) walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  const sel = new Set(selection);

  if (!doc.nodes.length) return <p className="text-[13px] text-muted">Nothing here yet. Add a model or a blockout shape.</p>;
  return (
    <ul aria-label="Scene objects" tabIndex={0} className="lp-scroll flex max-h-[22rem] flex-col overflow-y-auto border border-rule-strong lg:max-h-none lg:flex-1">
      {rows.map(({ node: n, depth }) => {
        const state = n.asset ? assets.get(n.asset) : undefined;
        const missing = n.type === "model" && (!state || state.status === "failed");
        const hasKids = kids.has(n.id);
        return (
          <li key={n.id} className={cn("flex items-center gap-1 border-t border-rule pr-1 first:border-t-0", sel.has(n.id) && "bg-hover", !n.visible && "opacity-60")}>
            <span style={{ width: depth * 12 }} className="shrink-0" aria-hidden />
            {hasKids ? (
              <button
                type="button"
                aria-label={`${collapsed.has(n.id) ? "Expand" : "Collapse"} ${n.name}`}
                aria-expanded={!collapsed.has(n.id)}
                className="w-4 shrink-0 cursor-pointer font-ocr text-[11px] text-muted hover:text-bright"
                onClick={() =>
                  setCollapsed((c) => {
                    const next = new Set(c);
                    if (next.has(n.id)) next.delete(n.id);
                    else next.add(n.id);
                    return next;
                  })
                }
              >
                {collapsed.has(n.id) ? "▸" : "▾"}
              </button>
            ) : (
              <span className="w-4 shrink-0" aria-hidden />
            )}
            <button
              type="button"
              aria-pressed={sel.has(n.id)}
              onClick={(e) => onSelect(n.id, e.shiftKey ? "range" : e.ctrlKey || e.metaKey ? "toggle" : "replace")}
              className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left"
            >
              <span aria-hidden className="shrink-0 font-ocr text-[10px] text-muted">
                {KIND[n.type]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-fg">{n.name || "Untitled"}</span>
              {missing ? <span className="shrink-0 font-ocr text-[10.5px] text-bright">{state?.status === "failed" ? "! failed" : "! missing"}</span> : state?.status === "loading" ? <span className="shrink-0 font-ocr text-[10.5px] text-muted">…</span> : null}
            </button>
            <button type="button" aria-pressed={!n.visible} title={n.visible ? "Hide" : "Show"} aria-label={`${n.visible ? "Hide" : "Show"} ${n.name}`} onClick={() => onToggle(n.id, "visible")} className="w-6 shrink-0 cursor-pointer font-ocr text-[11px] text-muted hover:text-bright">
              {n.visible ? "◉" : "○"}
            </button>
            <button type="button" aria-pressed={n.locked} title={n.locked ? "Unlock" : "Lock"} aria-label={`${n.locked ? "Unlock" : "Lock"} ${n.name}`} onClick={() => onToggle(n.id, "locked")} className={cn("w-6 shrink-0 cursor-pointer font-ocr text-[11px] hover:text-bright", n.locked ? "text-bright" : "text-muted")}>
              {n.locked ? "▣" : "□"}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
