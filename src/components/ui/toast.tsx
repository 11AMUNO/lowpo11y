"use client";

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
 * Show a toast from anywhere (components, worker callbacks, async handlers).
 * Errors stay until dismissed; others auto-dismiss.
 */
export function toast(input: Omit<ToastItem, "id" | "tone"> & { tone?: ToastTone }) {
  const id = nextId++;
  items = [...items.slice(-2), { tone: "info", ...input, id }];
  emit();
  if (input.tone !== "danger") setTimeout(() => dismiss(id), input.action ? 6000 : 2800);
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
const EMPTY: ToastItem[] = [];
const getServerSnapshot = () => EMPTY;

const PREFIX: Record<ToastTone, string> = { info: ">", ok: ">", danger: "!" };

/** Seamless-style toasts: centred at the bottom, black with a white frame and glow. */
export function Toaster() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-[2000] flex w-[min(34rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2" aria-live="polite" role="status">
      {list.map((t) => (
        <div
          key={t.id}
          role={t.tone === "danger" ? "alert" : undefined}
          className="pointer-events-auto flex max-w-full items-start gap-3 border border-bright bg-bg px-4 py-2 font-ocr text-[13px] tracking-[0.08em] text-bright uppercase shadow-[var(--crt-glow)] animate-[lp-pop_160ms_ease-out]"
        >
          <div className="min-w-0">
            <p>
              {PREFIX[t.tone]} {t.title}
            </p>
            {t.description ? <p className="mt-0.5 break-words text-muted normal-case">{t.description}</p> : null}
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
                className="mt-1 cursor-pointer underline underline-offset-4"
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss(t.id)}
            aria-label="Dismiss notification"
            className={cn("-mr-1 cursor-pointer px-1 text-muted hover:text-bright")}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
