import { Panel } from "@/components/ui/panel";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { summariseUsage, usageTotals } from "@/lib/analytics/record";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { formatCount } from "@/lib/format";

export const metadata = { title: "Usage" };

const pct = (v: number | null) => (v === null ? "—" : `${Math.round(v * 100)}%`);
const PERIODS = [7, 30, 90] as const;

/** Anonymous usage counts against the plan's success metrics. */
export default async function UsagePage({ searchParams }: PageProps<"/admin/usage">) {
  const user = await requireStaffPage("/admin/usage");
  const sp = await searchParams;
  const days = PERIODS.find((d) => String(d) === sp.days) ?? 30;
  const s = summariseUsage(await withDb(contextFor(user), (q) => usageTotals(q, days)));
  const stat = (label: string, value: string) => (
    <li className="flex items-baseline justify-between gap-4 border-b border-dashed border-rule-strong py-1.5 font-ocr text-[13px] tracking-[0.06em] uppercase">
      <span className="text-muted">{label}</span>
      <strong className="font-normal glow">{value}</strong>
    </li>
  );
  return (
    <div className="mx-auto max-w-[105rem]">
      <h1 className="type-display">Usage</h1>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; anonymous counts // no cookies, addresses or identifiers // last {days} days</p>
      <nav aria-label="Period" className="mt-4 flex gap-2">
        {PERIODS.map((d) => (
          <a key={d} href={`/admin/usage?days=${d}`} aria-current={d === days ? "page" : undefined} className="border border-edge px-2 py-1 font-ocr text-xs text-muted uppercase hover:text-bright aria-[current=page]:border-bright aria-[current=page]:text-bright">
            {d} days
          </a>
        ))}
      </nav>
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Visits">
          <ul>
            {stat("Page views", formatCount(s.pageViews))}
            {stat("New browsers (per day)", formatCount(s.visits.new))}
            {stat("Returning browsers (per day)", formatCount(s.visits.returning))}
          </ul>
        </Panel>
        <Panel title="Search to download">
          <ul>
            {stat("Searches", formatCount(s.searches))}
            {stat("Downloads after a search", formatCount(s.downloads.search))}
            {stat("Downloads while browsing", formatCount(s.downloads.browse))}
            {stat("Search → download", pct(s.searchToDownload))}
          </ul>
        </Panel>
        <Panel title="3D previews">
          {s.previews.length ? (
            <ul>{s.previews.map((p) => stat(`${p.where} errors`, `${pct(p.errorRate)} of ${formatCount(p.ok + p.error)}`))}</ul>
          ) : (
            <p className="text-[13px] text-muted">No previews counted yet.</p>
          )}
        </Panel>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <Panel title="Tools: files saved per page view">
          {s.tools.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Tool</Th>
                  <Th className="text-right">Views</Th>
                  <Th className="text-right">Files saved</Th>
                  <Th className="text-right">Rate</Th>
                </tr>
              </THead>
              <TBody>
                {s.tools.map((t) => (
                  <tr key={t.section}>
                    <Td>{t.section.replace(/^tool-/, "")}</Td>
                    <Td className="text-right">{formatCount(t.views)}</Td>
                    <Td className="text-right">{formatCount(t.exports)}</Td>
                    <Td className="text-right">{pct(t.rate)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-[13px] text-muted">No tool use counted yet.</p>
          )}
        </Panel>
        <Panel title="Core Web Vitals">
          {s.vitals.length ? (
            <Table>
              <THead>
                <tr>
                  <Th>Metric</Th>
                  <Th className="text-right">Samples</Th>
                  <Th className="text-right">Average</Th>
                  <Th className="text-right">Rated good</Th>
                </tr>
              </THead>
              <TBody>
                {s.vitals.map((v) => (
                  <tr key={v.metric}>
                    <Td>{v.metric.toUpperCase()}</Td>
                    <Td className="text-right">{formatCount(v.samples)}</Td>
                    <Td className="text-right">{v.metric === "cls" ? (v.average / 1000).toFixed(3) : `${formatCount(Math.round(v.average))} ms`}</Td>
                    <Td className="text-right">{pct(v.goodShare)}</Td>
                  </tr>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-[13px] text-muted">No measurements yet.</p>
          )}
        </Panel>
      </div>
      <p className="mt-4 type-data text-muted">Browsers that send Do Not Track or Global Privacy Control are never counted, and neither are the admin, sign-in pages or obvious bots. Visits are per browser per day, decided on the device.</p>
    </div>
  );
}
