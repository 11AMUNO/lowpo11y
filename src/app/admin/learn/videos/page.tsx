import { ContentListPage } from "@/features/admin/content/pages";

export const metadata = { title: "Videos" };

export default function Page({ searchParams }: PageProps<"/admin/learn/videos">) {
  return <ContentListPage kind="tutorial" searchParams={searchParams} />;
}
