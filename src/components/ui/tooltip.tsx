"use client";

import { Tooltip as RTooltip } from "radix-ui";
import type { ReactNode } from "react";

export const TooltipProvider = RTooltip.Provider;

export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RTooltip.Root delayDuration={350}>
      <RTooltip.Trigger asChild>{children}</RTooltip.Trigger>
      <RTooltip.Portal>
        <RTooltip.Content
          side={side}
          sideOffset={6}
          className="z-[60] max-w-64 border border-edge bg-bg px-2 py-1 font-ocr text-[11px] tracking-[0.04em] text-fg data-[state=delayed-open]:animate-[lp-fade_100ms_ease-out]"
        >
          {content}
        </RTooltip.Content>
      </RTooltip.Portal>
    </RTooltip.Root>
  );
}
