"use client";

import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";

export type ToastTone = "info" | "ok" | "danger";

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

type Listener = () => void;
let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const emit = () => listeners.forEach((l) => l());

function dismiss(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}

/**
 * Show a toast from anywhere (components, workers' callbacks, async handlers).
 * Errors stay until dismissed; other toasts auto-dismiss after 5s.
 */
export function toast(input: Omit<ToastItem, "id" | "tone"> & { tone?: ToastTone }) {
  const id = nextId++;
  items = [...items.slice(-3), { tone: "info", ...input, id }];
  emit();
  if (input.tone !== "danger") setTimeout(() => dismiss(id), 5000);
  return id;
}
toast.ok = (title: string, description?: string) => toast({ tone: "ok", title, description });
toast.error = (title: string, description?: string) => toast({ tone: "danger", title, description });
toast.dismiss = dismiss;

const subscribe = (l: Listener) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const getSnapshot = () => items;
const getServerSnapshot = (): ToastItem[] => [];

const icons = { info: Info, ok: CheckCircle2, danger: AlertTriangle };
const toneClass = { info: "text-info", ok: "text-ok", danger: "text-danger" };

export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      aria-live="polite"
      aria-relevant="additions"
      role="status"
    >
      {list.map((t) => {
        const Icon = icons[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "danger" ? "alert" : undefined}
            className="pointer-events-auto flex items-start gap-3 rounded-md border border-rule-strong bg-panel-2 p-3 data-[tone=danger]:border-danger/50 animate-[lp-pop_140ms_ease-out]"
            data-tone={t.tone}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", toneClass[t.tone])} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="type-label text-fg">{t.title}</p>
              {t.description ? <p className="type-small mt-0.5 break-words text-muted">{t.description}</p> : null}
              {t.action ? (
                <button
                  type="button"
                  onClick={() => {
                    t.action?.onClick();
                    dismiss(t.id);
                  }}
                  className="type-label mt-2 text-accent hover:underline"
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              className="-m-1 grid size-6 place-items-center rounded-sm text-muted hover:bg-panel hover:text-fg"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
