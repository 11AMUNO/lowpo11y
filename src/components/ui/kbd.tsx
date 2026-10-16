import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-xs border border-rule-strong border-b-2 bg-panel px-1 font-mono text-[0.625rem] text-muted",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
