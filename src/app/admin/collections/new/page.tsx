import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { Panel } from "@/components/ui/panel";
import { NewCollectionForm } from "@/features/admin/collection-editor/new-collection-form";

export const metadata = { title: "New collection" };

export default function NewCollectionPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Breadcrumbs items={[{ label: "Admin", href: "/admin" }, { label: "Collections", href: "/admin/collections" }, { label: "New" }]} />
      <h1 className="type-display mt-4">New collection</h1>
      <p className="mt-2 text-[14px] text-muted">Name it here, then add assets on the next screen.</p>
      <Panel title="Collection" className="mt-6">
        <NewCollectionForm />
      </Panel>
    </div>
  );
}
