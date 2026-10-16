import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

const SPIN = ["|", "/", "-", "\\"];

/** Text spinner in the terminal idiom. */
export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn("inline-flex items-center gap-2 font-ocr text-xs text-muted", className)}>
      <span aria-hidden className="inline-block w-[1ch] animate-pulse">
        {SPIN[0]}
      </span>
      <span>{label.toUpperCase()}…</span>
    </span>
  );
}

export interface ProgressProps {
  /** 0..1, or null for indeterminate. */
  value: number | null;
  label: string;
  className?: string;
  showValue?: boolean;
}

/** ASCII progress bar: [██████░░░░░░] 52%. */
export function Progress({ value, label, className, showValue = true }: ProgressProps) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  const cells = 24;
  const filled = pct === null ? 0 : Math.round((pct / 100) * cells);
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      className={cn("flex items-center gap-2 font-ocr text-xs tracking-normal", className)}
    >
      {showValue ? <span className="shrink-0 tracking-[0.08em] text-muted uppercase">{label}</span> : null}
      <span aria-hidden className="flex-1 overflow-hidden whitespace-pre text-faint">
        {pct === null ? (
          <span className="inline-block animate-pulse glow">{"░▒▓█▓▒░"}</span>
        ) : (
          <>
            <b className="font-normal glow">{"█".repeat(filled)}</b>
            {"░".repeat(cells - filled)}
          </>
        )}
      </span>
      {pct !== null ? <span className="shrink-0 glow">{pct}%</span> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse border border-rule bg-panel", className)} />;
}

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** An empty screen is an invitation to act: say what is missing and what to do next. */
export function EmptyState({ title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-start gap-3 border border-dashed border-edge bg-sunken px-5 py-8", className)}>
      <h2 className="font-ocr text-sm tracking-[0.08em] uppercase glow">
        &gt; {title}
        <span className="lp-cursor" aria-hidden />
      </h2>
      {children ? <div className="max-w-[68ch] text-muted">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export interface ErrorStateProps {
  title: string;
  children?: ReactNode;
  /** Usually a retry button. */
  action?: ReactNode;
  className?: string;
}

export function ErrorState({ title, children, action, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 border border-bright bg-sunken px-5 py-6 shadow-[var(--crt-glow)]", className)}>
      <h2 className="font-ocr text-sm tracking-[0.08em] uppercase glow">! {title}</h2>
      {children ? <div className="max-w-[68ch] text-muted">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

/** Inline notice. "warn" uses the bright Seamless `.warn` frame. */
export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warn"; title?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("border px-3 py-2.5 font-ocr text-xs tracking-[0.04em]", tone === "warn" ? "border-bright text-bright" : "border-rule-strong bg-sunken text-muted", className)}>
      {title ? <p className="mb-0.5 tracking-[0.1em] text-bright uppercase">{tone === "warn" ? "! " : "> "}{title}</p> : null}
      <div className="[&_a]:text-bright [&_a]:underline">{children}</div>
    </div>
  );
}
