import type { Metadata } from "next";
import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { Notice } from "@/components/ui/feedback";
import { Container } from "@/components/site/page-header";
import { SetupForm } from "@/features/admin/setup-form";
import { setupMode } from "@/lib/auth/setup";
import { setupOpen } from "@/lib/auth/sessions";
import { SERVICE, withDb } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "First-time setup", robots: { index: false } };

export default async function SetupPage() {
  const open = await withDb(SERVICE, (q) => setupOpen(q));
  const mode = setupMode();
  return (
    <Container className="max-w-md py-16">
      <h1 className="type-display">First-time setup</h1>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">&gt; Create the owner account</p>
      <Panel title="Admin account" className="mt-6">
        {!open ? (
          <p className="text-muted">
            Setup is complete. <Link href="/auth/login" className="text-bright underline">Sign in</Link> instead.
          </p>
        ) : mode === "disabled" ? (
          <Notice tone="warn" title="Setup is locked">
            Add a <code>SETUP_TOKEN</code> environment variable (any long random string) to your host, redeploy, then
            reload this page. See docs/DEPLOYMENT.md.
          </Notice>
        ) : (
          <SetupForm needsToken={mode === "token"} />
        )}
      </Panel>
    </Container>
  );
}
