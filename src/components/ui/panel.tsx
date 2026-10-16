"use client";

import { Collapsible } from "radix-ui";
import { ChevronDown } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface PanelProps {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Right-aligned controls in the header (reset button, toggle). */
  actions?: ReactNode;
  className?: string;
}

/** Collapsible inspector section used in tool sidebars. */
export function Panel({ title, children, defaultOpen = true, actions, className }: PanelProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible.Root open={open} onOpenChange={setOpen} className={cn("border-b border-rule", className)}>
      <div className="flex items-center gap-2 pr-3">
        <Collapsible.Trigger className="flex h-10 flex-1 items-center gap-2 px-3 text-left hover:text-fg">
          <ChevronDown className={cn("size-3.5 text-muted transition-transform duration-150", !open && "-rotate-90")} aria-hidden />
          <span className="type-label">{title}</span>
        </Collapsible.Trigger>
        {actions}
      </div>
      <Collapsible.Content className="flex flex-col gap-3.5 px-3 pb-4">{children}</Collapsible.Content>
    </Collapsible.Root>
  );
}
