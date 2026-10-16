"use client";

import { useSyncExternalStore } from "react";

let now = "";
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(l: () => void) {
  listeners.add(l);
  if (!timer) {
    const tick = () => {
      now = new Date().toLocaleTimeString("en-GB");
      listeners.forEach((fn) => fn());
    };
    tick();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(l);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** "SYS 21:14:03" — the Seamless footer clock. */
export function SysClock() {
  const t = useSyncExternalStore(
    subscribe,
    () => now,
    () => "",
  );
  return <span aria-hidden>{t ? `SYS ${t}` : "SYS --:--:--"}</span>;
}
