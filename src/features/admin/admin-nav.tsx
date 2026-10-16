"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import { ADMIN_NAV } from "./nav";

export function AdminNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname() ?? "/admin";
  return (
    <nav aria-label="Admin" className="flex flex-wrap items-center">
      {ADMIN_NAV.filter((n) => isAdmin || !n.adminOnly).map((n) => {
        const active = n.href === "/admin" ? pathname === "/admin" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-11 items-center px-2.5 font-ocr text-[12px] tracking-[0.1em] text-muted uppercase hover:text-bright",
              active && "text-bright [text-shadow:var(--crt-glow)] after:absolute after:inset-x-2.5 after:bottom-0 after:h-px after:bg-bright",
            )}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
