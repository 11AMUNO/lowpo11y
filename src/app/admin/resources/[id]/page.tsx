import { EditContentPage } from "@/features/admin/content/pages";

export const metadata = { title: "Edit resources" };

export default function Page({ params }: PageProps<"/admin/resources/[id]">) {
  return <EditContentPage kind="resource" params={params} />;
}
