import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd className={cn("inline-flex h-5 min-w-5 items-center justify-center border border-edge bg-sunken px-1 font-ocr text-[11px] text-muted", className)}>
      {children}
    </kbd>
  );
}
