import type { ContentKind } from "./repository";

/** What each content kind is called in the admin and in messages. */
export const KIND_LABEL: Record<ContentKind, { one: string; many: string; admin: string }> = {
  shader: { one: "Shader", many: "Shaders & code", admin: "/admin/shaders" },
  starter: { one: "Starter project", many: "Starter projects", admin: "/admin/starter-projects" },
  creator: { one: "Creator", many: "Creators", admin: "/admin/learn/creators" },
  tutorial: { one: "Video", many: "Videos", admin: "/admin/learn/videos" },
  resource: { one: "Resource", many: "Resources", admin: "/admin/resources" },
};

/** Where an entry is edited in the admin. */
export const adminEditPath = (kind: ContentKind, id: string) => `${KIND_LABEL[kind].admin}/${id}`;

/** The public page for a row, or null when it has none of its own. */
export function publicPath(kind: ContentKind, slug: string): string {
  switch (kind) {
    case "shader":
      return `/shaders/${slug}`;
    case "starter":
      return `/starter-projects/${slug}`;
    case "creator":
      return `/learn/creators/${slug}`;
    case "tutorial":
      return `/learn/videos/${slug}`;
    case "resource":
      return `/resources#${slug}`;
  }
}

/** Public download route for a shader or starter project bundle. */
export const downloadPath = (kind: "shader" | "starter", slug: string) => `/api/${kind === "shader" ? "shaders" : "starter-projects"}/${slug}/download`;
