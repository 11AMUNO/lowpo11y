/** Brand + site constants. Domain is a placeholder until the owner configures one. */
export const site = {
  name: "LOWPO11Y",
  tagline: "Low-poly assets, retro texture tools and a browser scene builder",
  description:
    "Free low-poly models and textures, browser-based retro texture tools, engine shaders and starter projects for PS1, PS2 and N64-inspired games.",
  url: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  contactEmail: process.env.NEXT_PUBLIC_CONTACT_EMAIL ?? "",
} as const;

export function absoluteUrl(path = "/"): string {
  return new URL(path, site.url).toString();
}
