"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { OnOff } from "./button";

/** Bordered panel with a "// TITLE" heading (Seamless `.panel`). */
export function Panel({
  title,
  aside,
  children,
  className,
  as: Tag = "section",
  labelledBy,
}: {
  title?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  as?: "section" | "div" | "aside";
  labelledBy?: string;
}) {
  return (
    <Tag className={cn("relative border border-rule-strong bg-panel p-3.5", className)} aria-labelledby={labelledBy}>
      {title ? (
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id={labelledBy} className="type-panel">
            // {title}
          </h2>
          {aside}
        </div>
      ) : null}
      {children}
    </Tag>
  );
}

export interface ModuleProps {
  /** Two-digit step number, e.g. "01". */
  n?: string;
  name: string;
  /** One-line summary shown in the header (always visible). */
  summary?: ReactNode;
  /** When provided, an ON/OFF switch is shown; OFF folds the module down. */
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  defaultOpen?: boolean;
  children: ReactNode;
  className?: string;
}

/** Pipeline module (Seamless `.mod`): numbered header, summary, ON/OFF, collapsible body. */
export function Module({ n, name, summary, enabled, onEnabledChange, defaultOpen = true, children, className }: ModuleProps) {
  const [open, setOpen] = useState(defaultOpen);
  const off = enabled === false;
  const showBody = open && !off;
  return (
    <div className={cn("mb-2.5 border border-rule-strong", off ? "bg-transparent" : "bg-sunken", className)}>
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          type="button"
          aria-expanded={showBody}
          onClick={() => setOpen((o) => !o)}
          className="flex cursor-pointer items-center gap-2 py-0.5 font-ocr text-[13px] tracking-[0.1em] text-bright uppercase [text-shadow:var(--crt-glow)]"
        >
          <span aria-hidden className="w-[0.8em] text-muted">
            {showBody ? "▾" : "▸"}
          </span>
          {n ? (
            <span aria-hidden className="text-faint">
              {n}
            </span>
          ) : null}
          <span className={cn(off && "text-muted [text-shadow:none]")}>{name}</span>
        </button>
        <span className="min-w-0 flex-1 truncate text-right font-ocr text-[11px] tracking-[0.04em] text-muted uppercase">{off ? "" : summary}</span>
        {enabled !== undefined && onEnabledChange ? (
          <OnOff on={enabled} onToggle={() => onEnabledChange(!enabled)} label={`Turn ${name.toLowerCase()} ${enabled ? "off" : "on"}`} />
        ) : null}
      </div>
      {showBody ? <div className="flex flex-col gap-2.5 border-t border-dashed border-rule-strong px-2.5 pt-2.5 pb-3">{children}</div> : null}
    </div>
  );
}

/** Collapsible "▸ ADVANCED" section (Seamless `details.adv`). */
export function Advanced({ label = "Advanced", children, defaultOpen = false }: { label?: string; children: ReactNode; defaultOpen?: boolean }) {
  return (
    <details open={defaultOpen} className="group border-t border-dashed border-rule-strong pt-2">
      <summary className="cursor-pointer list-none font-ocr text-[11.5px] tracking-[0.12em] text-muted uppercase hover:text-bright [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="group-open:hidden">▸ </span>
        <span aria-hidden className="hidden group-open:inline">▾ </span>
        {label}
      </summary>
      <div className="mt-2.5 flex flex-col gap-2.5">{children}</div>
    </details>
  );
}
