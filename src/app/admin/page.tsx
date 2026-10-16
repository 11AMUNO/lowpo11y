import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { Panel } from "@/components/ui/panel";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { getDb, withDb } from "@/lib/db";
import { env } from "@/lib/env";
import { formatBytes } from "@/lib/format";

export const metadata = { title: "Dashboard" };

interface Counts {
  drafts: number;
  review: number;
  published: number;
  archived: number;
  files: number;
  bytes: number;
  missing_licence: number;
  new_messages: number;
  open_takedowns: number;
}

export default async function AdminDashboard() {
  const user = await requireStaffPage("/admin");
  const counts = await withDb(contextFor(user), async (q) => {
    const [c] = await q.query<Counts>(`
      select
        count(*) filter (where status = 'draft' and deleted_at is null)::int as drafts,
        count(*) filter (where status = 'review' and deleted_at is null)::int as review,
        count(*) filter (where status = 'published' and deleted_at is null)::int as published,
        count(*) filter (where status = 'archived' and deleted_at is null)::int as archived,
        (select count(*)::int from asset_files where deleted_at is null) as files,
        (select coalesce(sum(size_bytes), 0)::bigint from asset_files where deleted_at is null) as bytes,
        count(*) filter (where deleted_at is null and (licence_id is null or ownership_attested_at is null))::int as missing_licence,
        (select count(*)::int from contact_messages where status = 'new') as new_messages,
        (select count(*)::int from contact_messages where kind = 'takedown' and status <> 'resolved') as open_takedowns
      from assets`);
    return c!;
  });
  const db = await getDb();
  const e = env();
  const stat = (label: string, value: string | number) => (
    <li className="flex items-baseline justify-between gap-4 border-b border-dashed border-rule-strong py-1.5 font-ocr text-[13px] tracking-[0.06em] uppercase">
      <span className="text-muted">{label}</span>
      <strong className="font-normal glow">{value}</strong>
    </li>
  );
  return (
    <div className="mx-auto max-w-[105rem]">
      <h1 className="type-display">Dashboard</h1>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">
        &gt; Signed in as {user.displayName} // {user.role}
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/admin/assets/new" className={buttonClasses("primary", "md")}>
          [ New asset ]
        </Link>
        <Link href="/admin/assets?problem=licence" className={buttonClasses("secondary", "md")}>
          Needs licence ({counts.missing_licence})
        </Link>
        <Link href="/admin/assets?status=review" className={buttonClasses("secondary", "md")}>
          In review ({counts.review})
        </Link>
        <Link href="/admin/messages?status=new" className={buttonClasses("secondary", "md")}>
          New messages ({counts.new_messages})
        </Link>
      </div>
      {counts.open_takedowns ? (
        <p role="status" className="mt-3 border border-bright px-3 py-2 font-ocr text-xs tracking-[0.06em] text-bright uppercase">
          ! {counts.open_takedowns} open takedown {counts.open_takedowns === 1 ? "request" : "requests"} //{" "}
          <Link href="/admin/messages" className="underline">
            review now
          </Link>
        </p>
      ) : null}
      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Panel title="Library">
          <ul>
            {stat("Published", counts.published)}
            {stat("In review", counts.review)}
            {stat("Drafts", counts.drafts)}
            {stat("Archived", counts.archived)}
            {stat("Missing licence or attestation", counts.missing_licence)}
          </ul>
        </Panel>
        <Panel title="Storage">
          <ul>
            {stat("Files", counts.files)}
            {stat("Bytes stored", formatBytes(counts.bytes))}
            {stat("Provider", e.STORAGE_PROVIDER === "r2" ? "Cloudflare R2" : "Local disk")}
          </ul>
        </Panel>
        <Panel title="System">
          <ul>
            {stat("Database", db.kind === "pglite" ? "Embedded (PGlite)" : "Postgres")}
            {stat("Environment", e.NODE_ENV)}
          </ul>
        </Panel>
      </div>
    </div>
  );
}
