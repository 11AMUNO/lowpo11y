import { ContentListPage } from "@/features/admin/content/pages";

export const metadata = { title: "Shaders" };

export default function Page({ searchParams }: PageProps<"/admin/shaders">) {
  return <ContentListPage kind="shader" searchParams={searchParams} />;
}
