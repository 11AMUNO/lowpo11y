import Link from "next/link";
import { Panel } from "@/components/ui/panel";
import { auditLicences } from "@/lib/assets/licence-audit";
import { contextFor, requireStaffPage } from "@/lib/auth/server";
import { withDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";

export const metadata = { title: "Licences audit" };
export const dynamic = "force-dynamic";

/** Every published asset checked for licence, credit, provenance and real files. */
export default async function LicencesAuditPage({ searchParams }: PageProps<"/admin/licences">) {
  const user = await requireStaffPage("/admin/licences");
  const deep = (await searchParams).deep === "1";
  const audit = await withDb(contextFor(user), (q) => auditLicences(q, getStorage(), { deep }));
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="type-display">Licences audit</h1>
      <p className="mt-2 font-ocr text-[13px] tracking-[0.08em] text-muted uppercase">
        &gt; {audit.checked} published assets // {audit.files} published files{deep ? " // bundles opened" : ""}
      </p>
      <p className="mt-3 max-w-prose text-[13px] text-muted">
        Checks that each published asset has a known licence that allows downloads, an ownership attestation, attribution text when the licence needs credit, a source link for third-party work, and that every published file is in the public bucket at its recorded size.{" "}
        {deep ? (
          <Link href="/admin/licences" className="text-bright underline">
            Run the quick check
          </Link>
        ) : (
          <Link href="/admin/licences?deep=1" className="text-bright underline">
            Also open every bundle to find its LICENSE.txt
          </Link>
        )}
        . The same check runs from the command line with <code>pnpm audit:licences --deep</code>.
      </p>
      <Panel title={audit.findings.length ? `${audit.findings.length} need attention` : "All clear"} className="mt-6">
        {audit.findings.length ? (
          <ul className="flex flex-col gap-3">
            {audit.findings.map((f) => (
              <li key={f.assetId} className="border-b border-dashed border-rule-strong pb-3 last:border-b-0">
                <Link href={`/admin/assets/${f.assetId}`} className="text-bright underline underline-offset-4">
                  {f.title}
                </Link>
                <ul className="mt-1 flex flex-col gap-0.5 text-[13px] text-fg">
                  {f.problems.map((p) => (
                    <li key={p}>! {p}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-fg">&gt; Every published asset passes{deep ? ", bundles included" : ""}.</p>
        )}
      </Panel>
    </div>
  );
}
