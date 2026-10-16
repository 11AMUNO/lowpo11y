import { CatalogPage, catalogMetadata, type CatalogPageConfig } from "@/features/catalog/catalog-page";

export const dynamic = "force-dynamic";

const cfg: CatalogPageConfig = {
  basePath: "/assets",
  title: "Assets",
  description: "Low-poly models, props, textures and modular packs, each with a preview, mesh statistics and a clear licence.",
  noun: "assets",
  elsewhere: { label: "Browse textures", href: "/textures" },
};

export function generateMetadata({ searchParams }: PageProps<"/assets">) {
  return catalogMetadata(cfg, searchParams);
}

export default function AssetsPage({ searchParams }: PageProps<"/assets">) {
  return <CatalogPage cfg={cfg} searchParams={searchParams} />;
}
