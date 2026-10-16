import Link from "next/link";
import { buttonClasses } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/feedback";
import { Table, TBody, Td, Th, THead } from "@/components/ui/table";
import { StatusBadge } from "@/features/admin/status-badge";
import { listAdminCollections } from "@/lib/assets/admin";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { formatDate, pluralise } from "@/lib/format";

export const metadata = { title: "Collections" };

export default async function AdminCollectionsPage() {
  const user = await requireStaffPage("/admin/collections");
  const cols = await withDb(contextFor(user), (q) => listAdminCollections(q));
  return (
    <div className="mx-auto max-w-[105rem]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="type-display">Collections</h1>
          <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; {pluralise(cols.length, "collection")}</p>
        </div>
        <Link href="/admin/collections/new" className={buttonClasses("primary", "md")}>
          [ New collection ]
        </Link>
      </div>
      <div className="mt-5">
        {cols.length ? (
          <Table>
            <THead>
              <tr>
                <Th>Title</Th>
                <Th>Status</Th>
                <Th>Assets</Th>
                <Th>Pack built</Th>
                <Th>Updated</Th>
              </tr>
            </THead>
            <TBody>
              {cols.map((c) => (
                <tr key={c.id}>
                  <Td>
                    <Link href={`/admin/collections/${c.id}`} className="text-fg hover:text-bright hover:underline">
                      {c.title}
                    </Link>
                    <span className="block font-ocr text-[11px] text-muted">
                      {c.slug}
                      {c.featured ? " // featured" : ""}
                    </span>
                  </Td>
                  <Td>
                    <StatusBadge status={c.status} />
                  </Td>
                  <Td className="font-ocr text-xs text-muted">{c.asset_count}</Td>
                  <Td className="font-ocr text-xs text-muted">{c.bundle_built_at ? formatDate(c.bundle_built_at) : "Not built"}</Td>
                  <Td className="font-ocr text-xs text-muted">{formatDate(c.updated_at)}</Td>
                </tr>
              ))}
            </TBody>
          </Table>
        ) : (
          <EmptyState
            title="No collections yet"
            action={
              <Link href="/admin/collections/new" className={buttonClasses("secondary", "md")}>
                Create a collection
              </Link>
            }
          >
            <p>Group published assets that share a scale and palette into a pack people can download in one go.</p>
          </EmptyState>
        )}
      </div>
    </div>
  );
}
