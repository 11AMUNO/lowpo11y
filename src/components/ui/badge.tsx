import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "accent" | "ok" | "danger" | "info" | "outline";

const tones: Record<BadgeTone, string> = {
  neutral: "bg-panel-2 text-fg border-rule",
  accent: "bg-accent-soft text-accent border-accent/35",
  ok: "bg-ok-soft text-ok border-ok/35",
  danger: "bg-danger-soft text-danger border-danger/35",
  info: "bg-info-soft text-info border-info/35",
  outline: "bg-transparent text-muted border-rule-strong",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}

export function Badge({ tone = "neutral", icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-xs border px-1.5 text-[0.6875rem] leading-none font-[580] whitespace-nowrap [&_svg]:size-3",
        tones[tone],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

/** File-format badge, e.g. GLB, PNG, BLEND. Shown in the mono face because it is literal data. */
export function FormatBadge({ format, className }: { format: string; className?: string }) {
  return (
    <span
      className={cn(
        "type-data inline-flex h-5 items-center rounded-xs border border-rule-strong px-1.5 text-[0.625rem] text-muted",
        className,
      )}
    >
      {format.toUpperCase()}
    </span>
  );
}
