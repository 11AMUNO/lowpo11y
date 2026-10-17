/** Single source of truth for primary navigation (header, mobile menu, footer, search). */
export interface NavItem {
  label: string;
  href: string;
  description: string;
}

export const PRIMARY_NAV: NavItem[] = [
  { label: "Assets", href: "/assets", description: "Low-poly models, props and packs" },
  { label: "Textures", href: "/textures", description: "Tileable textures at retro resolutions" },
  { label: "Tools", href: "/tools", description: "Texture, palette, atlas, font and model tools in your browser" },
  { label: "Shaders & Code", href: "/shaders", description: "Engine shaders and starter projects" },
  { label: "Learn", href: "/learn", description: "Hand-picked tutorials and creators" },
  { label: "Resources", href: "/resources", description: "Vetted external tools and references" },
  { label: "Scene Builder", href: "/scene-builder", description: "Block out a small 3D scene and export GLB" },
];

export const FOOTER_NAV: { heading: string; items: { label: string; href: string }[] }[] = [
  {
    heading: "Library",
    items: [
      { label: "Assets", href: "/assets" },
      { label: "Textures", href: "/textures" },
      { label: "Collections", href: "/collections" },
      { label: "Shaders", href: "/shaders" },
      { label: "Starter projects", href: "/starter-projects" },
    ],
  },
  {
    heading: "Make",
    items: [
      { label: "Tools", href: "/tools" },
      { label: "Workshop", href: "/workshop" },
      { label: "Scene Builder", href: "/scene-builder" },
    ],
  },
  {
    heading: "Learn",
    items: [
      { label: "Videos", href: "/learn" },
      { label: "Creators", href: "/learn/creators" },
      { label: "Resources", href: "/resources" },
    ],
  },
  {
    heading: "About",
    items: [
      { label: "About LOWPO11Y", href: "/about" },
      { label: "Licences", href: "/licences" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
      { label: "Contact and takedowns", href: "/contact" },
    ],
  },
];
