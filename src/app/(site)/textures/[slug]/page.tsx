import { AssetDetailPage, assetDetailMetadata } from "@/features/catalog/asset-detail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps<"/textures/[slug]">) {
  return assetDetailMetadata((await params).slug);
}

export default async function Page({ params }: PageProps<"/textures/[slug]">) {
  return <AssetDetailPage slug={(await params).slug} section="textures" />;
}
