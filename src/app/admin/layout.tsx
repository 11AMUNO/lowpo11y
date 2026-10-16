import type { Metadata } from "next";
import Link from "next/link";
import { AdminNav } from "@/features/admin/admin-nav";
import { SignOutButton } from "@/features/admin/sign-out-button";
import { Wordmark } from "@/components/site/logo";
import { requireStaffPage } from "@/lib/auth/server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Admin", template: "%s | Admin | LOWPO11Y" }, robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await requireStaffPage("/admin");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-40 border-b border-rule-strong bg-bg">
        <div className="flex items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex h-11 shrink-0 items-center gap-2" aria-label="LOWPO11Y site">
            <Wordmark />
            <span className="font-ocr text-[12px] tracking-[0.12em] text-muted">// ADMIN</span>
          </Link>
          <AdminNav isAdmin={user.role === "admin"} />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden font-ocr text-[11px] tracking-[0.08em] text-muted uppercase sm:inline">
              {user.displayName} // {user.role}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1 px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
