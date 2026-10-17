import { ContentListPage } from "@/features/admin/content/pages";

export const metadata = { title: "Resources" };

export default function Page({ searchParams }: PageProps<"/admin/resources">) {
  return <ContentListPage kind="resource" searchParams={searchParams} />;
}
