"use client";

import { Tabs as RTabs } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Tabs = RTabs.Root;

export function TabList({ children, label, className }: { children: ReactNode; label: string; className?: string }) {
  return (
    <RTabs.List aria-label={label} className={cn("flex gap-1 border-b border-rule-strong", className)}>
      {children}
    </RTabs.List>
  );
}

export function Tab({ value, children, className }: { value: string; children: ReactNode; className?: string }) {
  return (
    <RTabs.Trigger
      value={value}
      className={cn(
        "-mb-px h-9 cursor-pointer border-b border-transparent px-3 font-ocr text-xs tracking-[0.1em] text-muted uppercase transition-colors hover:text-bright data-[state=active]:border-bright data-[state=active]:text-bright data-[state=active]:[text-shadow:var(--crt-glow)]",
        className,
      )}
    >
      {children}
    </RTabs.Trigger>
  );
}

export const TabPanel = RTabs.Content;
