/**
 * Licences audit of every published asset (see src/lib/assets/licence-audit.ts).
 *
 *   pnpm audit:licences [--deep] [--json]
 *
 * --deep also opens each download bundle to find its LICENSE.txt. Exits 1
 * when anything needs attention, so it can gate a release.
 */
import "./_env";
import { parseArgs } from "node:util";
import { auditLicences } from "@/lib/assets/licence-audit";
import { SERVICE, withDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";

const { values } = parseArgs({ options: { deep: { type: "boolean", default: false }, json: { type: "boolean", default: false } } });
const result = await withDb(SERVICE, (q) => auditLicences(q, getStorage(), { deep: values.deep }));
if (values.json) console.log(JSON.stringify(result, null, 2));
else {
  console.log(`Checked ${result.checked} published assets and ${result.files} published files${values.deep ? " (bundles opened)" : ""}.`);
  for (const f of result.findings) console.log(`\n! ${f.title} (/${f.slug})\n${f.problems.map((p) => `  - ${p}`).join("\n")}`);
  console.log(result.findings.length ? `\n${result.findings.length} asset(s) need attention.` : "All published assets pass.");
}
process.exit(result.findings.length ? 1 : 0);
