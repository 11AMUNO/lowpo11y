"use client";

import { useRef } from "react";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { colNames, extOf, isCustom, itemsIn, LOOSE, parentOf, rowSub, type Entry, type Item } from "./model";
import type { ExportFormat } from "./protocol";

interface Props {
  items: Item[];
  cols: Record<string, { collapsed: boolean }>;
  active: number | null;
  format: ExportFormat;
  dragging: boolean;
  onIngest: (entries: Entry[]) => void;
  onSample: () => void;
  onSelect: (id: number) => void;
  onRemove: (id: number) => void;
  onToggleCol: (col: string) => void;
  onRenameCol: (col: string) => void;
  onRemoveCol: (col: string) => void;
  onAllCols: (collapsed: boolean) => void;
  onClear: () => void;
}

const small = "cursor-pointer border border-edge bg-sunken px-2 py-1 font-ocr text-[11px] tracking-[0.05em] text-muted uppercase hover:border-edge-hover hover:text-bright";

export function LibraryPanel({ items, cols, active, format, dragging, onIngest, onSample, onSelect, onRemove, onToggleCol, onRenameCol, onRemoveCol, onAllCols, onClear }: Props) {
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  return (
    <section aria-label="Library" className="flex min-h-0 flex-col border border-rule-strong bg-panel p-3">
      <h2 className="type-panel mb-2.5">// Library</h2>
      <div
        className={cn(
          "flex flex-col items-center gap-1.5 border border-dashed border-edge bg-sunken px-3 py-4 text-center transition-[border-color,box-shadow] hover:border-bright hover:shadow-[var(--crt-glow)]",
          dragging && "border-solid border-bright shadow-[var(--crt-glow)]",
        )}
      >
        <button type="button" onClick={() => folderRef.current?.click()} className="cursor-pointer font-ocr tracking-[0.1em] uppercase glow">
          [ Drop folders or files ]
        </button>
        <span className="font-ocr text-[11px] tracking-[0.04em] text-muted">each folder becomes a collection</span>
        <span className="mt-1 flex flex-wrap justify-center gap-1.5">
          <button type="button" className={small} onClick={() => folderRef.current?.click()}>
            + Folder
          </button>
          <button type="button" className={small} onClick={() => filesRef.current?.click()}>
            + Files
          </button>
          <button type="button" className={small} onClick={onSample} title="Load the LOWPO11Y demo textures (CC0)">
            + Sample
          </button>
        </span>
        <input
          ref={filesRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="Image files"
          onChange={(e) => {
            onIngest([...(e.target.files ?? [])].map((file) => ({ file, col: LOOSE })));
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          aria-label="Image folder"
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            onIngest([...(e.target.files ?? [])].map((file) => ({ file, col: parentOf(file.webkitRelativePath || "") || LOOSE })));
            e.target.value = "";
          }}
        />
      </div>

      {items.length ? (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <button type="button" className={small} onClick={() => onAllCols(true)}>
            Collapse all
          </button>
          <button type="button" className={small} onClick={() => onAllCols(false)}>
            Expand all
          </button>
          <button type="button" className={cn(small, "ml-auto")} onClick={onClear}>
            Clear
          </button>
        </div>
      ) : null}

      <div className="lp-scroll mt-2 min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <p className="py-3 font-ocr text-xs tracking-[0.08em] text-muted">
            &gt; NO FILES LOADED<span className="lp-cursor" aria-hidden />
          </p>
        ) : (
          colNames(cols).map((c) => {
            const list = itemsIn(items, c);
            if (!list.length) return null;
            const collapsed = cols[c]!.collapsed;
            const hasActive = list.some((i) => i.id === active);
            return (
              <section key={c} className="border-b border-dashed border-rule-strong py-1.5 last:border-0">
                <div className={cn("flex items-center gap-1", hasActive && "text-bright")}>
                  <button
                    type="button"
                    aria-expanded={!collapsed}
                    onClick={() => onToggleCol(c)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left font-ocr text-[12px] tracking-[0.08em] uppercase hover:text-bright"
                  >
                    <span aria-hidden className="text-muted">
                      {collapsed ? "▸" : "▾"}
                    </span>
                    <span className={cn("truncate", hasActive ? "glow" : "text-fg")}>{c}</span>
                  </button>
                  <span className="font-ocr text-[11px] text-muted">{list.length}</span>
                  <button type="button" onClick={() => onRenameCol(c)} title="Rename collection (used as the export folder name)" aria-label={`Rename collection ${c}`} className="inline-grid size-6 cursor-pointer place-items-center text-muted hover:text-bright">
                    ✎
                  </button>
                  <button type="button" onClick={() => onRemoveCol(c)} title="Remove collection" aria-label={`Remove collection ${c}`} className="inline-grid size-6 cursor-pointer place-items-center text-muted hover:text-bright">
                    ×
                  </button>
                </div>
                {!collapsed ? (
                  <ol className="flex flex-col">
                    {list.map((it) => {
                      const custom = isCustom(it);
                      const isActive = it.id === active;
                      return (
                        <li key={it.id} className={cn("grid grid-cols-[36px_1fr_auto] items-center gap-2 border-l-2 px-1.5 py-1", isActive ? "border-bright bg-hover" : "border-transparent hover:bg-hover")}>
                          <img src={it.thumb} alt="" loading="lazy" decoding="async" className="size-9 border border-rule-strong bg-checker object-cover" />
                          <button type="button" onClick={() => onSelect(it.id)} aria-current={isActive ? "true" : undefined} className="min-w-0 cursor-pointer text-left">
                            <span className={cn("block truncate text-[12.5px]", isActive ? "text-bright" : "text-fg")}>
                              {it.name}
                              {extOf(format)}
                            </span>
                            <span className="block truncate font-ocr text-[10.5px] tracking-[0.04em] text-muted">{rowSub(it)}</span>
                          </button>
                          <span className="flex items-center gap-0.5">
                            <span className={cn("w-3 text-center text-xs", custom ? "text-bright" : "text-muted")} title={custom ? "Customised settings" : "Default settings"}>
                              <span aria-hidden>{custom ? "✎" : "·"}</span>
                              <span className="sr-only">{custom ? "Customised settings" : "Default settings"}</span>
                            </span>
                            <button type="button" onClick={() => onRemove(it.id)} aria-label={`Remove ${it.base}`} title="Remove" className="inline-grid size-6 cursor-pointer place-items-center text-muted hover:text-bright">
                              ×
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ol>
                ) : null}
              </section>
            );
          })
        )}
      </div>
      <p className="mt-2 font-ocr text-[11px] tracking-[0.04em] text-muted">
        Keys: <Kbd>↑</Kbd>/<Kbd>↓</Kbd> select · <Kbd>D</Kbd> download · <Kbd>T</Kbd> tile/split · <Kbd>Del</Kbd> remove
      </p>
    </section>
  );
}
