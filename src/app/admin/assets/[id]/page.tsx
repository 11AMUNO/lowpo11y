import { notFound } from "next/navigation";
import { z } from "@/lib/zod";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Panel } from "@/components/ui/panel";
import { AuditList } from "@/features/admin/audit-list";
import { DetailsForm } from "@/features/admin/asset-editor/details-form";
import { FilesPanel } from "@/features/admin/asset-editor/files-panel";
import { LicenceForm } from "@/features/admin/asset-editor/licence-form";
import { PublishPanel } from "@/features/admin/asset-editor/publish-panel";
import type { EditorAsset, EditorFile } from "@/features/admin/asset-editor/types";
import { StatusBadge } from "@/features/admin/status-badge";
import { auditFor, categoryOptions, licenceOptions } from "@/lib/assets/admin";
import type { LicenceInfo } from "@/lib/assets/bundle";
import { publishChecklist } from "@/lib/assets/publish";
import { getAssetById, listAssetFiles, listAssetTags } from "@/lib/assets/repository";
import { ASSET_TYPE_LABEL, assetPath } from "@/lib/assets/schemas";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { env } from "@/lib/env";

export const metadata = { title: "Edit asset" };

export default async function EditAssetPage({ params }: PageProps<"/admin/assets/[id]">) {
  const { id } = await params;
  const user = await requireStaffPage(`/admin/assets/${id}`);
  if (!z.uuid().safeParse(id).success) notFound();
  const data = await withDb(contextFor(user), async (q) => {
    const asset = await getAssetById(q, id);
    if (!asset || asset.deleted_at) return null;
    const [files, tags, licences, categories, history, [attester], [licence]] = await Promise.all([
      listAssetFiles(q, id),
      listAssetTags(q, id),
      licenceOptions(q),
      categoryOptions(q),
      auditFor(q, "asset", id, 40),
      asset.ownership_attested_by ? q.query<{ display_name: string }>("select display_name from user_names where id = $1", [asset.ownership_attested_by]) : Promise.resolve([]),
      asset.licence_id ? q.query<LicenceInfo>("select * from licences where id = $1", [asset.licence_id]) : Promise.resolve([]),
    ]);
    return { asset, files, tags, licences, categories, history, attester, licence: licence ?? null };
  });
  if (!data) notFound();
  const { asset: a, files, tags, licences, categories, history, attester, licence } = data;
  const isAdmin = user.role === "admin";
  // Editors work on drafts and review; published and archived assets are admin-only (RLS enforces it too).
  const readOnly = !isAdmin && (a.status === "published" || a.status === "archived");

  const editorAsset: EditorAsset = {
    id: a.id,
    slug: a.slug,
    title: a.title,
    assetType: a.asset_type,
    status: a.status,
    shortDescription: a.short_description,
    descriptionMd: a.description_md,
    usageNotesMd: a.usage_notes_md,
    categoryId: a.category_id,
    licenceId: a.licence_id,
    attributionText: a.attribution_text,
    licenceSourceUrl: a.licence_source_url,
    provenanceKind: a.provenance_kind,
    provenanceNotes: a.provenance_notes,
    featured: a.featured,
    engines: a.engines,
    tags: tags.map((t) => t.name),
    attestedAt: a.ownership_attested_at ? new Date(a.ownership_attested_at).toISOString() : null,
    attestedBy: attester?.display_name ?? null,
    isDemo: a.is_demo,
    publicPath: a.status === "published" ? assetPath(a) : null,
  };
  const editorFiles: EditorFile[] = files.map((f) => ({
    id: f.id,
    purpose: f.purpose,
    filename: f.original_filename,
    format: f.format,
    sizeBytes: Number(f.size_bytes),
    width: f.width,
    height: f.height,
    triangles: f.model_triangle_count,
    sizeVariant: f.size_variant,
    generated: (f.metadata?.generated as string | undefined) ?? null,
    note: (f.metadata?.note as string | undefined) ?? null,
    isPrimary: f.is_primary,
    published: f.published,
    isPublic: !!f.public_key,
  }));
  const thumb = files.find((f) => f.purpose === "thumbnail" && f.is_primary) ?? files.find((f) => f.purpose === "thumbnail");

  return (
    <div className="mx-auto max-w-[105rem]">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Assets", href: "/admin/assets" }, { label: a.title }]} />
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="type-display">{a.title}</h1>
        <StatusBadge status={a.status} />
      </div>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">
        &gt; {ASSET_TYPE_LABEL[a.asset_type]} // {a.slug} // v{a.version}
        {a.is_demo ? " // demo content" : ""}
      </p>
      {readOnly ? <p className="mt-2 text-[13px] text-muted">This asset is {a.status}. Only admins can change it.</p> : null}

      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <Panel title="Details">
            <DetailsForm asset={editorAsset} categories={categories.map((c) => ({ id: c.id, label: c.name }))} readOnly={readOnly} />
          </Panel>
          <Panel title="Licence and rights">
            <LicenceForm
              asset={editorAsset}
              licences={licences.map((l) => ({ id: l.id, label: `${l.human_label} (${l.short_label})`, hint: l.allows_download ? undefined : "Downloads stay blocked with this licence.", attribution: l.attribution_required }))}
              readOnly={readOnly}
            />
          </Panel>
          <Panel title="Files">
            <FilesPanel assetId={a.id} files={editorFiles} maxBytes={env().MAX_UPLOAD_BYTES} readOnly={readOnly} />
          </Panel>
        </div>
        <aside className="flex flex-col gap-5" aria-label="Publishing">
          <Panel title="Publish">
            <PublishPanel asset={editorAsset} checklist={publishChecklist(a, files, licence)} isAdmin={isAdmin} />
          </Panel>
          {thumb ? (
            <Panel title="Thumbnail">
              <img src={`/api/admin/files/${thumb.id}`} alt={`${a.title} thumbnail`} className="aspect-square w-full border border-rule-strong bg-sunken object-contain" />
            </Panel>
          ) : null}
          <Panel title="History">
            {isAdmin ? <AuditList entries={history} compact /> : <p className="text-xs text-muted">The change history is visible to admins.</p>}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
