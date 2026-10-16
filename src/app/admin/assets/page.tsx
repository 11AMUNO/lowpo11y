import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Pagination } from "@/components/ui/pagination";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { StatusBadge } from "@/features/admin/status-badge";
import { adminListSchema, ASSET_STATUSES, listAdminAssets, type AdminListParams } from "@/lib/assets/admin";
import { ASSET_TYPE_LABEL, ASSET_TYPES } from "@/lib/assets/schemas";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { cn } from "@/lib/cn";
import { formatDate, pluralise } from "@/lib/format";

export const metadata = { title: "Assets" };

function qs(p: Partial<AdminListParams>) {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) s.set(k, String(v));
  const out = s.toString();
  return out ? `?${out}` : "";
}

export default async function AdminAssetsPage({ searchParams }: PageProps<"/admin/assets">) {
  const user = await requireStaffPage("/admin/assets");
  const raw = await searchParams;
  const p = adminListSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const { items, total, pageCount } = await withDb(contextFor(user), (q) => listAdminAssets(q, p));
  const tabs: { label: string; params: Partial<AdminListParams> }[] = [
    { label: "All", params: {} },
    ...ASSET_STATUSES.map((s) => ({ label: s === "review" ? "In review" : s[0]!.toUpperCase() + s.slice(1), params: { status: s } })),
    { label: "Needs licence", params: { problem: "licence" as const } },
    { label: "No files", params: { problem: "files" as const } },
  ];

  return (
    <div className="mx-auto max-w-[105rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-display">Assets</h1>
          <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; {pluralise(total, "asset")}</p>
        </div>
        <Link href="/admin/assets/new" className={buttonClasses("primary", "md")}>
          [ New asset ]
        </Link>
      </div>

      <nav aria-label="Filter by status" className="mt-5 flex flex-wrap gap-1.5">
        {tabs.map((t) => {
          const active = t.params.status === p.status && t.params.problem === p.problem;
          return (
            <Link
              key={t.label}
              href={`/admin/assets${qs({ ...t.params, q: p.q, type: p.type })}`}
              aria-current={active ? "page" : undefined}
              className={cn(buttonClasses("secondary", "sm"), active && "border-bright text-bright [text-shadow:var(--crt-glow)]")}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>

      <form method="get" className="mt-3 flex flex-wrap gap-2" role="search">
        {p.status ? <input type="hidden" name="status" value={p.status} /> : null}
        {p.problem ? <input type="hidden" name="problem" value={p.problem} /> : null}
        <label htmlFor="admin-q" className="sr-only">
          Search by title or slug
        </label>
        <input
          id="admin-q"
          name="q"
          type="search"
          defaultValue={p.q ?? ""}
          placeholder="title or slug…"
          className="h-8 min-w-60 flex-1 border border-edge-strong bg-sunken px-2.5 text-[13px] text-bright outline-none placeholder:text-muted focus-visible:border-bright"
        />
        <label htmlFor="admin-type" className="sr-only">
          Type
        </label>
        <select id="admin-type" name="type" defaultValue={p.type ?? ""} className="h-8 border border-edge-strong bg-sunken px-2 font-ocr text-xs text-fg uppercase">
          <option value="">All types</option>
          {ASSET_TYPES.map((t) => (
            <option key={t} value={t}>
              {ASSET_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
        <button type="submit" className={buttonClasses("secondary", "md")}>
          Filter
        </button>
      </form>

      <div className="mt-4">
        {items.length ? (
          <Table>
            <THead>
              <tr>
                <Th className="w-14">
                  <span className="sr-only">Thumbnail</span>
                </Th>
                <Th>Title</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Licence</Th>
                <Th>Files</Th>
                <Th>Updated</Th>
              </tr>
            </THead>
            <TBody>
              {items.map((a) => (
                <tr key={a.id} className="hover:bg-hover">
                  <Td>
                    <span className="block size-10 border border-rule-strong bg-sunken">
                      {a.thumbnail_url || a.thumb_file_id ? (
                        <img src={a.thumbnail_url ?? `/api/admin/files/${a.thumb_file_id}`} alt="" className="h-full w-full object-contain" loading="lazy" />
                      ) : null}
                    </span>
                  </Td>
                  <Td>
                    <Link href={`/admin/assets/${a.id}`} className="text-fg hover:text-bright hover:underline">
                      {a.title}
                    </Link>
                    <span className="block font-ocr text-[11px] text-muted">
                      {a.slug}
                      {a.is_demo ? " // demo" : ""}
                    </span>
                  </Td>
                  <Td className="font-ocr text-xs text-muted uppercase">{ASSET_TYPE_LABEL[a.asset_type]}</Td>
                  <Td>
                    <StatusBadge status={a.status} />
                  </Td>
                  <Td className="text-xs">
                    {a.licence_short ?? <span className="text-muted">Not set</span>}
                    {!a.attested ? <span className="block font-ocr text-[11px] text-muted">rights not confirmed</span> : null}
                  </Td>
                  <Td className="font-ocr text-xs text-muted">
                    {a.file_count} {a.formats.length ? `// ${a.formats.join(" ").toUpperCase()}` : ""}
                  </Td>
                  <Td className="font-ocr text-xs text-muted">{formatDate(a.updated_at)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="No assets match"
            action={
              <Link href="/admin/assets/new" className={buttonClasses("secondary", "md")}>
                Create an asset
              </Link>
            }
          >
            <p>Clear the filters, or create a draft and upload its files.</p>
          </EmptyState>
        )}
        <Pagination page={p.page} pageCount={pageCount} hrefFor={(n) => `/admin/assets${qs({ ...p, page: n })}`} className="mt-4" />
      </div>
    </div>
  );
}
