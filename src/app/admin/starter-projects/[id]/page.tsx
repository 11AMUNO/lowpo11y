import { EditContentPage } from "@/features/admin/content/pages";

export const metadata = { title: "Edit starter projects" };

export default function Page({ params }: PageProps<"/admin/starter-projects/[id]">) {
  return <EditContentPage kind="starter" params={params} />;
}
