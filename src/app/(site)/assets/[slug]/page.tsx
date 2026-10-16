import { AssetDetailPage, assetDetailMetadata } from "@/features/catalog/asset-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/assets/[slug]">) {
  return assetDetailMetadata((await params).slug);
}

export default async function Page({ params }: PageProps<"/assets/[slug]">) {
  return <AssetDetailPage slug={(await params).slug} section="assets" />;
}
