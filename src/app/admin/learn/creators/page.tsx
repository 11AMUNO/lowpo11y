import { ContentListPage } from "@/features/admin/content/pages";

export const metadata = { title: "Creators" };

export default function Page({ searchParams }: PageProps<"/admin/learn/creators">) {
  return <ContentListPage kind="creator" searchParams={searchParams} />;
}
