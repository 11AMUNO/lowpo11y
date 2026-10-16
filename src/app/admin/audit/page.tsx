import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { Pagination } from "@/components/ui/pagination";
import { AuditList } from "@/features/admin/audit-list";
import { auditListSchema, listAudit } from "@/lib/assets/admin";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";

export const metadata = { title: "Audit log" };

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const user = await requireStaffPage("/admin/audit");
  if (user.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const p = auditListSchema.parse({ action: sp.action, page: sp.page });
  const { items, pageCount } = await withDb(contextFor(user), (q) => listAudit(q, p));
  const qs = (page: number) => `/admin/audit?${new URLSearchParams({ ...(p.action ? { action: p.action } : {}), ...(page > 1 ? { page: String(page) } : {}) })}`;
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="type-display">Audit log</h1>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; every staff action // newest first</p>
      <form method="get" className="mt-5 flex gap-2">
        <label htmlFor="audit-action" className="sr-only">
          Filter by action
        </label>
        <select id="audit-action" name="action" defaultValue={p.action ?? ""} className="h-8 border border-edge-strong bg-sunken px-2 font-ocr text-xs text-fg uppercase">
          <option value="">All actions</option>
          <option value="asset.">Assets</option>
          <option value="asset.publish">Publishing</option>
          <option value="asset.file.">Files</option>
          <option value="collection.">Collections</option>
          <option value="import.">Imports</option>
          <option value="auth.">Sign-ins</option>
          <option value="message.">Messages</option>
        </select>
        <button type="submit" className="h-8 border border-edge bg-sunken px-2.5 font-ocr text-xs text-muted uppercase hover:text-bright">
          Filter
        </button>
      </form>
      <Panel className="mt-4">
        <AuditList entries={items} />
      </Panel>
      <Pagination page={p.page} pageCount={pageCount} hrefFor={qs} className="mt-4" />
    </div>
  );
}
