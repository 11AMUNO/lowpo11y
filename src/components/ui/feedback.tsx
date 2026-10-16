import { AlertTriangle, Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn("size-4 animate-spin text-muted", className)} aria-hidden />
      <span className="sr-only">{label}</span>
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

export function Progress({ value, label, className, showValue }: ProgressProps) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      {showValue ? (
        <div className="flex justify-between">
          <span className="type-small text-muted">{label}</span>
          {pct !== null ? <span className="type-data text-muted">{pct}%</span> : null}
        </div>
      ) : null}
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        className="relative h-1.5 overflow-hidden rounded-full bg-rule"
      >
        {pct === null ? (
          <div className="absolute inset-y-0 w-2/5 animate-[lp-indeterminate_1.1s_ease-in-out_infinite] bg-accent" />
        ) : (
          <div className="h-full bg-accent transition-[width] duration-200" style={{ width: `${pct}%` }} />
        )}
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-sm bg-panel-2", className)} />;
}

export interface EmptyStateProps {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

/** An empty screen is an invitation to act: say what is missing and what to do next. */
export function EmptyState({ title, children, action, icon, className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-md border border-dashed border-rule-strong px-6 py-10", className)}>
      {icon ? <div className="text-muted [&_svg]:size-6">{icon}</div> : null}
      <h2 className="type-subheading">{title}</h2>
      {children ? <div className="max-w-prose text-muted">{children}</div> : null}
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
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-md border border-danger/40 bg-danger-soft px-6 py-8", className)}>
      <AlertTriangle className="size-5 text-danger" aria-hidden />
      <h2 className="type-subheading">{title}</h2>
      {children ? <div className="max-w-prose text-muted">{children}</div> : null}
      {action ? <div className="mt-1 flex flex-wrap gap-2">{action}</div> : null}
    </div>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "accent" | "danger"; title?: string; children: ReactNode; className?: string }) {
  const toneClass = {
    info: "border-info/35 bg-info-soft",
    accent: "border-accent/35 bg-accent-soft",
    danger: "border-danger/40 bg-danger-soft",
  }[tone];
  return (
    <div className={cn("rounded-md border px-4 py-3 text-sm", toneClass, className)}>
      {title ? <p className="type-label mb-0.5 text-fg">{title}</p> : null}
      <div className="text-muted [&_a]:text-fg [&_a]:underline">{children}</div>
    </div>
  );
}
