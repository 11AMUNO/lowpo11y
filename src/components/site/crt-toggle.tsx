"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { CRT_STORAGE_KEY } from "@/lib/theme";

const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const read = () => document.documentElement.dataset.crt !== "off";

export function setCrt(on: boolean) {
  if (on) delete document.documentElement.dataset.crt;
  else document.documentElement.dataset.crt = "off";
  try {
    localStorage.setItem(CRT_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Storage may be unavailable (private mode); the setting still applies to this page.
  }
  listeners.forEach((l) => l());
}

/** Scanlines, vignette and glow on/off — the site's only display preference. */
export function CrtToggle({ className }: { className?: string }) {
  const on = useSyncExternalStore(subscribe, read, () => true);
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setCrt(!on)}
      title="Scanlines, vignette and glow"
      className={cn(
        "flex h-8 cursor-pointer items-center gap-1.5 border border-edge bg-sunken px-2 font-ocr text-[11px] tracking-[0.08em] text-muted uppercase hover:border-edge-hover hover:text-bright",
        className,
      )}
    >
      CRT
      <span className={cn("px-1", on ? "bg-bright text-bg [text-shadow:none]" : "text-muted")}>{on ? "ON" : "OFF"}</span>
    </button>
  );
}
