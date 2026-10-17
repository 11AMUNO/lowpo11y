import { NewContentPage } from "@/features/admin/content/pages";

export const metadata = { title: "New resource" };

export default function Page() {
  return <NewContentPage kind="resource" />;
}
