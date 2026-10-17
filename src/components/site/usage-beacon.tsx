"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";
import { track, trackVisit } from "@/lib/analytics/client";
import { sectionOf, VITALS } from "@/lib/analytics/events";

type Metric = Parameters<Parameters<typeof useReportWebVitals>[0]>[0];

// A stable function, so each metric is reported once.
function reportVital(m: Metric) {
  if (!(VITALS as readonly string[]).includes(m.name)) return;
  const section = sectionOf(new URL(m.navigationURL ?? location.href, location.href).pathname);
  if (!section) return;
  track("vital", `${m.name.toLowerCase()}:${section}`, { v: Math.round(m.value * (m.name === "CLS" ? 1000 : 1)), g: m.rating === "good" });
}

/** Page views, daily visits and Core Web Vitals, as anonymous counts (see the privacy page). */
export function UsageBeacon() {
  const pathname = usePathname();
  useReportWebVitals(reportVital);
  useEffect(() => {
    trackVisit();
  }, []);
  useEffect(() => {
    const section = sectionOf(pathname);
    if (section) track("page_view", section);
  }, [pathname]);
  return null;
}
