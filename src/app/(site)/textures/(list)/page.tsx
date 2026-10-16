import { TEXTURE_SECTION_TYPES } from "@/lib/assets/schemas";
import { CatalogPage, catalogMetadata, type CatalogPageConfig } from "@/features/catalog/catalog-page";

export const dynamic = "force-dynamic";

const cfg: CatalogPageConfig = {
  basePath: "/textures",
  title: "Textures",
  description: "Tileable textures, decals and skyboxes at retro resolutions, previewed with nearest-neighbour filtering so you see every texel.",
  noun: "textures",
  types: [...TEXTURE_SECTION_TYPES],
  elsewhere: { label: "Browse all assets", href: "/assets" },
};

export function generateMetadata({ searchParams }: PageProps<"/textures">) {
  return catalogMetadata(cfg, searchParams);
}

export default function TexturesPage({ searchParams }: PageProps<"/textures">) {
  return <CatalogPage cfg={cfg} searchParams={searchParams} />;
}
