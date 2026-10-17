import { EditContentPage } from "@/features/admin/content/pages";

export const metadata = { title: "Edit shaders" };

export default function Page({ params }: PageProps<"/admin/shaders/[id]">) {
  return <EditContentPage kind="shader" params={params} />;
}
