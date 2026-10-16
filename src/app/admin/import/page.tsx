import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ImportWizard } from "@/features/admin/import/import-wizard";
import { categoryOptions, licenceOptions } from "@/lib/assets/admin";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";

export const metadata = { title: "Bulk import" };

export default async function ImportPage() {
  const user = await requireStaffPage("/admin/import");
  const { licences, categories } = await withDb(contextFor(user), async (q) => ({ licences: await licenceOptions(q), categories: await categoryOptions(q) }));
  return (
    <div className="mx-auto max-w-[105rem]">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Assets", href: "/admin/assets" }, { label: "Bulk import" }]} />
      <h1 className="type-display mt-4">Bulk import</h1>
      <p className="mt-2 max-w-[72ch] text-[14px] leading-relaxed text-muted">
        Add many models and textures at once as drafts. Files upload straight to storage and are checked one by one, exactly like single uploads; FBX models are converted to GLB and every asset gets a thumbnail.
        For very large libraries, the <code className="text-fg">pnpm import:assets</code> command does the same from a terminal.
      </p>
      <div className="mt-6">
        <ImportWizard
          licences={licences.map((l) => ({ id: l.id, code: l.code, label: `${l.human_label} (${l.short_label})` }))}
          categories={categories.map((c) => ({ id: c.id, code: c.slug, label: c.name }))}
        />
      </div>
    </div>
  );
}
