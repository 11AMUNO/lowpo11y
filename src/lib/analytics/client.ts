"use client";

import { exportSubject, sectionOf, type UsageEvent } from "./events";

/** Visitors who ask not to be tracked (Do Not Track or Global Privacy Control) send nothing. */
function optedOut(): boolean {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean; msDoNotTrack?: string };
  return n.doNotTrack === "1" || n.msDoNotTrack === "1" || n.globalPrivacyControl === true;
}

/** Sends one usage count. Never throws and never blocks the page. */
export function track(e: UsageEvent, s = "", extra: { v?: number; g?: boolean } = {}): void {
  try {
    if (typeof window === "undefined" || optedOut() || sectionOf(location.pathname) === null) return;
    const body = JSON.stringify({ e, s: s.toLowerCase().replace(/[^a-z0-9:_-]/g, "-").slice(0, 64), ...extra });
    const blob = new Blob([body], { type: "application/json" });
    if (navigator.sendBeacon?.("/api/events", blob)) return;
    void fetch("/api/events", { method: "POST", body, headers: { "Content-Type": "application/json" }, keepalive: true }).catch(() => {});
  } catch {
    // counting is best-effort
  }
}

/** Counts a saved file from a tool, the Workshop or the Scene Builder. */
export function trackExport(filename: string): void {
  if (typeof window !== "undefined") track("export", exportSubject(location.pathname, filename));
}

const SEARCHED = "lp-searched";

/** A catalogue search; a download later in this tab counts as coming from search. */
export function trackSearch(kind: "assets" | "textures"): void {
  try {
    sessionStorage.setItem(SEARCHED, "1");
  } catch {
    // storage blocked: the download counts as browse
  }
  track("search", kind);
}

export function trackDownload(): void {
  let searched = false;
  try {
    searched = sessionStorage.getItem(SEARCHED) === "1";
  } catch {
    // storage blocked
  }
  track("download", searched ? "search" : "browse");
}

const LAST_VISIT = "lp-last-visit";

/** Once per day per browser: "new" the first time, "returning" after. Only the date is stored, on the device. */
export function trackVisit(): void {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const last = localStorage.getItem(LAST_VISIT);
    if (last === today) return;
    localStorage.setItem(LAST_VISIT, today);
    track("visit", last ? "returning" : "new");
  } catch {
    // storage blocked: no visit count
  }
}
