"use client";

import { DropdownMenu as RMenu } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Menu = RMenu.Root;
export const MenuTrigger = RMenu.Trigger;

export function MenuContent({ children, align = "end", className }: { children: ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <RMenu.Portal>
      <RMenu.Content
        align={align}
        sideOffset={6}
        className={cn(
          "z-50 min-w-48 border border-rule-strong bg-panel p-1 font-ocr text-xs tracking-[0.06em] text-fg uppercase data-[state=open]:animate-[lp-fade_100ms_ease-out]",
          className,
        )}
      >
        {children}
      </RMenu.Content>
    </RMenu.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  icon,
  destructive,
  disabled,
}: {
  children: ReactNode;
  onSelect?: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
}) {
  return (
    <RMenu.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 border-l-2 border-transparent px-2 text-muted outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:border-bright data-[highlighted]:bg-hover data-[highlighted]:text-bright [&_svg]:size-3.5",
        destructive && "text-fg",
      )}
    >
      {icon}
      {children}
    </RMenu.Item>
  );
}

export function MenuSeparator() {
  return <RMenu.Separator className="my-1 h-px border-t border-dashed border-rule-strong" />;
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <RMenu.Label className="px-2 py-1.5 text-muted">{children}</RMenu.Label>;
}
