import { notFound } from "next/navigation";
import { z } from "@/lib/zod";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { CollectionEditor } from "@/features/admin/collection-editor/collection-editor";
import { StatusBadge } from "@/features/admin/status-badge";
import { collectionMembers } from "@/lib/assets/admin";
import type { CollectionRow } from "@/lib/assets/collections";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { formatBytes, formatDate } from "@/lib/format";

export const metadata = { title: "Edit collection" };

export default async function EditCollectionPage({ params }: PageProps<"/admin/collections/[id]">) {
  const { id } = await params;
  const user = await requireStaffPage(`/admin/collections/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withDb(contextFor(user), async (q) => {
    const [col] = await q.query<CollectionRow>("select * from collections where id = $1 and deleted_at is null", [id]);
    return col ? { col, members: await collectionMembers(q, id) } : null;
  });
  if (!data) notFound();
  const { col, members } = data;
  return (
    <div className="mx-auto max-w-[105rem]">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Collections", href: "/admin/collections" }, { label: col.title }]} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="type-display">{col.title}</h1>
        <StatusBadge status={col.status} />
      </div>
      <p className="mt-2 mb-6 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">
        &gt; {col.slug}
        {col.bundle_built_at ? ` // pack ${formatBytes(Number(col.bundle_size_bytes ?? 0))} built ${formatDate(col.bundle_built_at)}` : " // pack not built"}
      </p>
      <CollectionEditor
        isAdmin={user.role === "admin"}
        collection={{
          id: col.id,
          slug: col.slug,
          title: col.title,
          summary: col.summary,
          descriptionMd: col.description_md,
          featured: col.featured,
          status: col.status,
          bundleBuiltAt: col.bundle_built_at ? new Date(col.bundle_built_at).toISOString() : null,
        }}
        members={members.map((m) => ({ id: m.id, title: m.title, slug: m.slug, status: m.status, thumbnail: m.thumbnail_url, licence: m.licence_short }))}
      />
    </div>
  );
}
