import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "bright" | "outline";

const tones: Record<BadgeTone, string> = {
  neutral: "border-rule-strong text-muted",
  bright: "border-bright text-bright [text-shadow:var(--crt-glow)]",
  outline: "border-edge text-muted",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
  icon?: ReactNode;
}

/** Bordered OCR tag, e.g. CC0, DEMO, READY. */
export function Badge({ tone = "neutral", icon, className, children, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 border bg-sunken px-1.5 font-ocr text-[11px] leading-none tracking-[0.06em] whitespace-nowrap uppercase [&_svg]:size-3",
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

/** File-format tag, e.g. GLB, PNG, FBX. */
export function FormatBadge({ format, className }: { format: string; className?: string }) {
  return <Badge className={className}>{format.toUpperCase()}</Badge>;
}
