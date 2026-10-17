import { EditContentPage } from "@/features/admin/content/pages";

export const metadata = { title: "Edit videos" };

export default function Page({ params }: PageProps<"/admin/learn/videos/[id]">) {
  return <EditContentPage kind="tutorial" params={params} />;
}
