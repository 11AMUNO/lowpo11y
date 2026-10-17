"use client";

import { useEffect } from "react";
import { trackSearch } from "@/lib/analytics/client";

/** Counts a catalogue search (not its text) once per query. */
export function SearchBeacon({ kind, q }: { kind: "assets" | "textures"; q: string }) {
  useEffect(() => {
    trackSearch(kind);
  }, [kind, q]);
  return null;
}
