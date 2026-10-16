/** Admin sections. Add an entry only when its page exists. */
export const ADMIN_NAV: { label: string; href: string; adminOnly?: boolean }[] = [
  { label: "Dashboard", href: "/admin" },
  { label: "Assets", href: "/admin/assets" },
  { label: "Collections", href: "/admin/collections" },
  { label: "Messages", href: "/admin/messages" },
  { label: "Audit log", href: "/admin/audit", adminOnly: true },
];
