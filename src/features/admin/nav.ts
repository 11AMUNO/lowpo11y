/** Admin sections. Add an entry only when its page exists. */
export const ADMIN_NAV: { label: string; href: string; adminOnly?: boolean }[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Assets", href: "/admin/assets" },
  { label: "Import", href: "/admin/import" },
  { label: "Collections", href: "/admin/collections" },
  { label: "Shaders", href: "/admin/shaders" },
  { label: "Starters", href: "/admin/starter-projects" },
  { label: "Learn", href: "/admin/learn" },
  { label: "Resources", href: "/admin/resources" },
  { label: "Messages", href: "/admin/messages" },
  { label: "Licences audit", href: "/admin/licences" },
  { label: "Usage", href: "/admin/usage" },
  { label: "Audit log", href: "/admin/audit", adminOnly: true },
];
