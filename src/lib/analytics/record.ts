/** Writing and summarising usage counts (service context for writes; staff can read). */
import type { Queryable } from "@/lib/db";
import type { UsagePayload } from "./payload";

export async function recordUsage(q: Queryable, p: UsagePayload, now = new Date()): Promise<void> {
  const day = now.toISOString().slice(0, 10);
  const value = p.e === "vital" ? (p.v ?? 0) : 0;
  const good = p.e === "vital" && p.g ? 1 : 0;
  await q.query(
    `insert into usage_daily (day, event, subject, count, value_sum, good) values ($1::date, $2, $3, 1, $4, $5)
     on conflict (day, event, subject) do update
       set count = usage_daily.count + 1, value_sum = usage_daily.value_sum + excluded.value_sum, good = usage_daily.good + excluded.good`,
    [day, p.e, p.s, value, good],
  );
}

export interface UsageRow {
  event: string;
  subject: string;
  count: number;
  valueSum: number;
  good: number;
}

/** Totals per event and subject over the last `days` days (today included). */
export async function usageTotals(q: Queryable, days = 30, now = new Date()): Promise<UsageRow[]> {
  const since = new Date(now.getTime() - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const rows = await q.query<{ event: string; subject: string; count: string | number; value_sum: string | number; good: string | number }>(
    `select event, subject, sum(count) as count, sum(value_sum) as value_sum, sum(good) as good
       from usage_daily where day >= $1::date
      group by event, subject order by event, sum(count) desc, subject`,
    [since],
  );
  return rows.map((r) => ({ event: r.event, subject: r.subject, count: Number(r.count), valueSum: Number(r.value_sum), good: Number(r.good) }));
}

export interface UsageSummary {
  pageViews: number;
  visits: { new: number; returning: number };
  searches: number;
  downloads: { search: number; browse: number };
  /** Downloads after a search per search, or null with no searches. */
  searchToDownload: number | null;
  /** Per tool section: page views, exports, and exports per view. */
  tools: { section: string; views: number; exports: number; rate: number | null }[];
  previews: { where: string; ok: number; error: number; errorRate: number | null }[];
  vitals: { metric: string; samples: number; average: number; goodShare: number }[];
}

const ratio = (a: number, b: number) => (b ? a / b : null);

export function summariseUsage(rows: UsageRow[]): UsageSummary {
  const sum = (event: string, pred: (s: string) => boolean = () => true) => rows.filter((r) => r.event === event && pred(r.subject)).reduce((n, r) => n + r.count, 0);
  const searches = sum("search");
  const downloads = { search: sum("download", (s) => s === "search"), browse: sum("download", (s) => s === "browse") };
  const views = new Map(rows.filter((r) => r.event === "page_view").map((r) => [r.subject, r.count]));
  const exportSections = new Map<string, number>();
  for (const r of rows.filter((x) => x.event === "export")) {
    const section = r.subject.split(":")[0]!;
    exportSections.set(section, (exportSections.get(section) ?? 0) + r.count);
  }
  const toolSections = new Set([...views.keys()].filter((s) => s.startsWith("tool-") || s === "workshop" || s === "scene-builder"));
  for (const s of exportSections.keys()) toolSections.add(s);
  const previewWhere = new Map<string, { ok: number; error: number }>();
  for (const r of rows.filter((x) => x.event === "preview")) {
    const [where = "other", result] = r.subject.split(":");
    const e = previewWhere.get(where) ?? { ok: 0, error: 0 };
    if (result === "error") e.error += r.count;
    else e.ok += r.count;
    previewWhere.set(where, e);
  }
  const vitals = new Map<string, { samples: number; total: number; good: number }>();
  for (const r of rows.filter((x) => x.event === "vital")) {
    const metric = r.subject.split(":")[0]!;
    const v = vitals.get(metric) ?? { samples: 0, total: 0, good: 0 };
    v.samples += r.count;
    v.total += r.valueSum;
    v.good += r.good;
    vitals.set(metric, v);
  }
  return {
    pageViews: sum("page_view"),
    visits: { new: sum("visit", (s) => s === "new"), returning: sum("visit", (s) => s === "returning") },
    searches,
    downloads,
    searchToDownload: ratio(downloads.search, searches),
    tools: [...toolSections]
      .map((section) => {
        const v = views.get(section) ?? 0;
        const x = exportSections.get(section) ?? 0;
        return { section, views: v, exports: x, rate: ratio(x, v) };
      })
      .sort((a, b) => b.views - a.views || a.section.localeCompare(b.section)),
    previews: [...previewWhere].map(([where, e]) => ({ where, ...e, errorRate: ratio(e.error, e.ok + e.error) })).sort((a, b) => a.where.localeCompare(b.where)),
    vitals: [...vitals].map(([metric, v]) => ({ metric, samples: v.samples, average: v.total / v.samples, goodShare: v.good / v.samples })).sort((a, b) => a.metric.localeCompare(b.metric)),
  };
}
