"use client";

import { Dialog as RDialog } from "radix-ui";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export const Dialog = RDialog.Root;
export const DialogTrigger = RDialog.Trigger;
export const DialogClose = RDialog.Close;

export interface DialogContentProps {
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** "center" for modals, "right" for side sheets. */
  placement?: "center" | "right";
  hideTitle?: boolean;
}

/** Terminal window: "// TITLE" bar, sunken body, footer actions. */
export function DialogContent({ title, description, children, footer, className, placement = "center", hideTitle }: DialogContentProps) {
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-[lp-fade_120ms_ease-out]" />
      <RDialog.Content
        className={cn(
          "fixed z-50 flex max-h-[min(88dvh,52rem)] flex-col border border-rule-strong bg-panel text-fg focus:outline-none",
          placement === "center" &&
            "top-1/2 left-1/2 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 data-[state=open]:animate-[lp-pop_140ms_ease-out]",
          placement === "right" && "top-0 right-0 h-dvh max-h-dvh w-[min(24rem,100vw)] border-y-0 border-r-0 data-[state=open]:animate-[lp-slide-in_160ms_ease-out]",
          className,
        )}
      >
        <div className={cn("flex items-start justify-between gap-4 border-b border-dashed border-rule-strong px-4 py-3", hideTitle && "sr-only")}>
          <div className="min-w-0">
            <RDialog.Title className="type-panel">// {title}</RDialog.Title>
            {description ? <RDialog.Description className="mt-1 text-muted">{description}</RDialog.Description> : null}
          </div>
          <RDialog.Close className="-mr-1 cursor-pointer px-1 font-ocr text-muted hover:text-bright" aria-label="Close">
            ×
          </RDialog.Close>
        </div>
        {!description ? <RDialog.Description className="sr-only">{title}</RDialog.Description> : null}
        <div className="lp-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-dashed border-rule-strong px-4 py-3">{footer}</div> : null}
      </RDialog.Content>
    </RDialog.Portal>
  );
}
