"use client";

import { Tabs as RTabs } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Tabs = RTabs.Root;

export function TabList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <RTabs.List aria-label={label} className={cn("flex gap-1 border-b border-rule", className)}>
      {children}
    </RTabs.List>
  );
}

export function Tab({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RTabs.Trigger
      value={value}
      className={cn(
        "-mb-px h-10 border-b-2 border-transparent px-3 text-sm text-muted transition-colors hover:text-fg data-[state=active]:border-accent data-[state=active]:text-fg",
        className,
      )}
    >
      {children}
    </RTabs.Trigger>
  );
}

export const TabPanel = RTabs.Content;
