import { ContentListPage } from "@/features/admin/content/pages";

export const metadata = { title: "Starter projects" };

export default function Page({ searchParams }: PageProps<"/admin/starter-projects">) {
  return <ContentListPage kind="starter" searchParams={searchParams} />;
}
