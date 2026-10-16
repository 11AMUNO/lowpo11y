import { Panel } from "@/components/ui/panel";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { NewAssetForm } from "@/features/admin/asset-editor/new-asset-form";

export const metadata = { title: "New asset" };

export default function NewAssetPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Assets", href: "/admin/assets" }, { label: "New" }]} />
      <h1 className="type-display mt-4">New asset</h1>
      <p className="mt-2 text-[14px] text-muted">Start a draft, then upload its files and set the licence on the next screen.</p>
      <Panel title="Draft" className="mt-6">
        <NewAssetForm />
      </Panel>
    </div>
  );
}
