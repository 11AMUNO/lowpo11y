import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Panel } from "@/components/ui/panel";
import { Container } from "@/components/site/page-header";
import { LoginForm } from "@/features/admin/login-form";
import { getCurrentUser } from "@/lib/auth/server";
import { safeNextPath } from "@/lib/auth/schemas";
import { adminCount, isStaff } from "@/lib/auth/sessions";
import { SERVICE, withDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: PageProps<"/auth/login">) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  const user = await getCurrentUser();
  if (isStaff(user) && sp.error !== "forbidden") redirect(next);
  const admins = await withDb(SERVICE, (q) => adminCount(q));
  const error = sp.error === "forbidden" ? "That account can't open the admin area." : undefined;

  return (
    <Container className="max-w-md py-16">
      <h1 className="type-display">Sign in</h1>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; Staff access // admin and editors</p>
      <Panel title="Credentials" className="mt-6">
        {admins === 0 ? (
          <p className="text-muted">
            No admin account exists yet. <Link href="/auth/setup" className="text-bright underline">Create the first admin</Link>.
          </p>
        ) : (
          <LoginForm next={next} initialError={error} />
        )}
      </Panel>
      <p className="mt-4 text-xs text-muted">Visitors don’t need an account: browsing, downloads and tools are open to everyone.</p>
    </Container>
  );
}
