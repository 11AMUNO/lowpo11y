"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SegmentedControl, SliderField } from "@/components/ui/controls";
import { Advanced } from "@/components/ui/panel";
import { PromptInput } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { extOf, safeName, treeLines, type Item } from "./model";
import type { ExportFormat } from "./protocol";

export const EXPORT_SIZES = [1024, 512, 256, 128] as const;

interface Props {
  active: Item | null;
  scopeItems: Item[];
  format: ExportFormat;
  quality: number;
  scope: "collection" | "all";
  sizes: number[];
  busy: string | null;
  onFormat: (f: ExportFormat) => void;
  onQuality: (q: number) => void;
  onName: (name: string) => void;
  onDownload: () => void;
  onSample: () => void;
  onScope: (s: "collection" | "all") => void;
  onSizes: (s: number[]) => void;
  onZip: () => void;
  onRename: (pattern: string) => void;
}

export function ExportPanel(p: Props) {
  const [pattern, setPattern] = useState("{name}");
  const sizes = [...p.sizes].sort((a, b) => b - a);
  const total = p.scopeItems.length * Math.max(1, sizes.length);
  return (
    <section aria-label="Export" className="border border-rule-strong bg-panel p-3">
      <h2 className="type-panel mb-2.5">// Export</h2>
      <div className="flex flex-col gap-2.5">
        <SegmentedControl
          label="Format"
          inline
          size="sm"
          value={p.format}
          onChange={p.onFormat}
          options={[
            { value: "png", label: "PNG" },
            { value: "jpg", label: "JPG" },
            { value: "webp", label: "WEBP" },
          ]}
        />
        {p.format !== "png" ? <SliderField label="Quality" value={p.quality} min={40} max={100} unit="%" onChange={p.onQuality} /> : null}

        <h3 className="type-label mt-1 border-t border-dashed border-rule-strong pt-2.5">This file</h3>
        <PromptInput
          aria-label="Filename"
          placeholder="filename"
          spellCheck={false}
          autoComplete="off"
          disabled={!p.active}
          value={p.active?.name ?? ""}
          onChange={(e) => p.onName(e.target.value)}
          onBlur={(e) => p.onName(safeName(e.target.value))}
          suffix={extOf(p.format)}
        />
        <div className="grid grid-cols-2 gap-1.5">
          <Button variant="primary" disabled={!p.active || !!p.busy} onClick={p.onDownload}>
            Download
          </Button>
          <Button disabled={!p.active || !!p.busy} onClick={p.onSample} title="A 3×3 tiled preview image">
            [ 3×3 sample ]
          </Button>
        </div>

        <h3 className="type-label mt-1 border-t border-dashed border-rule-strong pt-2.5">Batch</h3>
        <SegmentedControl
          label="Scope"
          inline
          size="sm"
          value={p.scope}
          onChange={p.onScope}
          options={[
            { value: "collection", label: "Collection", disabled: !p.active },
            { value: "all", label: "Everything" },
          ]}
        />
        <div className="grid grid-cols-[80px_1fr] items-center gap-2">
          <span className="type-label" id="sizes-label">
            Sizes
          </span>
          <div role="group" aria-labelledby="sizes-label" className="flex">
            {EXPORT_SIZES.map((s, i) => {
              const on = p.sizes.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={on}
                  onClick={() => p.onSizes(on ? p.sizes.filter((x) => x !== s) : [...p.sizes, s])}
                  className={cn(
                    "h-7 flex-1 cursor-pointer border border-edge bg-sunken font-ocr text-[11px] tracking-[0.05em] text-muted hover:border-edge-hover hover:text-bright",
                    "aria-pressed:relative aria-pressed:z-10 aria-pressed:border-bright aria-pressed:text-bright aria-pressed:[text-shadow:var(--crt-glow)]",
                    i > 0 && "-ml-px",
                  )}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>
        <pre aria-label="Zip layout preview" className="lp-scroll max-h-40 overflow-auto border border-rule-strong bg-sunken px-2.5 py-2 font-mono text-[11.5px] leading-snug text-muted">
          {p.scopeItems.length ? treeLines(p.scopeItems, sizes).join("\n") : "> nothing to export yet"}
        </pre>
        <Button variant="primary" className="w-full" disabled={!p.scopeItems.length || !!p.busy} onClick={p.onZip}>
          {p.busy?.startsWith("zip") ? "Exporting…" : `Export ZIP // ${total} file${total === 1 ? "" : "s"}`}
        </Button>

        <Advanced label="Batch rename">
          <PromptInput aria-label="Rename pattern" spellCheck={false} autoComplete="off" value={pattern} onChange={(e) => setPattern(e.target.value)} />
          <p className="font-ocr text-[11px] tracking-[0.04em] text-muted">
            Tokens: <code className="text-fg">{"{name}"}</code> original · <code className="text-fg">{"{n}"}</code> 01, 02… · <code className="text-fg">{"{collection}"}</code> ·{" "}
            <code className="text-fg">{"{mode}"}</code>
          </p>
          <Button disabled={!p.scopeItems.length} onClick={() => p.onRename(pattern)}>
            [ Rename in scope ]
          </Button>
        </Advanced>
      </div>
    </section>
  );
}
