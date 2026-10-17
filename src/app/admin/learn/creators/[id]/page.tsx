import { EditContentPage } from "@/features/admin/content/pages";

export const metadata = { title: "Edit creators" };

export default function Page({ params }: PageProps<"/admin/learn/creators/[id]">) {
  return <EditContentPage kind="creator" params={params} />;
}
