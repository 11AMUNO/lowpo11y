"use client";

import { Dialog as RDialog } from "radix-ui";
import { X } from "lucide-react";
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
  /** "center" for modals, "right" for side sheets, "top" for the command palette. */
  placement?: "center" | "right" | "top";
  hideTitle?: boolean;
}

export function DialogContent({
  title,
  description,
  children,
  footer,
  className,
  placement = "center",
  hideTitle,
}: DialogContentProps) {
  return (
    <RDialog.Portal>
      <RDialog.Overlay className="fixed inset-0 z-50 bg-scrim data-[state=open]:animate-[lp-fade_120ms_ease-out]" />
      <RDialog.Content
        className={cn(
          "fixed z-50 flex max-h-[min(88dvh,52rem)] flex-col border border-rule-strong bg-panel text-fg focus:outline-none",
          placement === "center" &&
            "top-1/2 left-1/2 w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg data-[state=open]:animate-[lp-pop_140ms_ease-out]",
          placement === "top" &&
            "top-[10dvh] left-1/2 w-[calc(100vw-2rem)] max-w-2xl -translate-x-1/2 rounded-lg data-[state=open]:animate-[lp-pop_140ms_ease-out]",
          placement === "right" &&
            "top-0 right-0 h-dvh max-h-dvh w-[min(24rem,100vw)] border-y-0 border-r-0 data-[state=open]:animate-[lp-slide-in_160ms_ease-out]",
          className,
        )}
      >
        <div className={cn("flex items-start justify-between gap-4 border-b border-rule px-5 py-4", hideTitle && "sr-only")}>
          <div className="min-w-0">
            <RDialog.Title className="type-heading">{title}</RDialog.Title>
            {description ? (
              <RDialog.Description className="type-small mt-1 text-muted">{description}</RDialog.Description>
            ) : null}
          </div>
          <RDialog.Close
            className="-mr-2 grid size-8 shrink-0 place-items-center rounded-sm text-muted hover:bg-panel-2 hover:text-fg"
            aria-label="Close"
          >
            <X className="size-4" />
          </RDialog.Close>
        </div>
        {!description ? <RDialog.Description className="sr-only">{title}</RDialog.Description> : null}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer ? <div className="flex flex-wrap justify-end gap-2 border-t border-rule px-5 py-3">{footer}</div> : null}
      </RDialog.Content>
    </RDialog.Portal>
  );
}
