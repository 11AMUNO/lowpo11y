/**
 * Licences audit: every published asset must have a known, downloadable
 * licence, an ownership attestation, attribution text when its licence
 * needs credit, a source link for third-party work, and published files that
 * really exist in the public bucket at their recorded size, including the
 * download bundle (and, with `deep`, a LICENSE.txt inside that bundle).
 * Read-only. Run as staff or service.
 */
import { unzipSync } from "fflate";
import type { Queryable } from "@/lib/db";
import type { AssetStorage } from "@/lib/storage";

export interface AuditFinding {
  assetId: string;
  slug: string;
  title: string;
  problems: string[];
}

export interface LicenceAudit {
  checked: number;
  files: number;
  findings: AuditFinding[];
}

export async function auditLicences(q: Queryable, storage: AssetStorage, opts: { deep?: boolean } = {}): Promise<LicenceAudit> {
  const assets = await q.query<{
    id: string;
    slug: string;
    title: string;
    code: string | null;
    allows_download: boolean | null;
    attribution_required: boolean | null;
    attribution_text: string | null;
    licence_source_url: string | null;
    provenance_kind: string | null;
    ownership_attested_at: Date | null;
    bundle_file_id: string | null;
  }>(
    `select a.id, a.slug, a.title, l.code, l.allows_download, l.attribution_required, a.attribution_text, a.licence_source_url,
            a.provenance_kind, a.ownership_attested_at, a.bundle_file_id
       from assets a left join licences l on l.id = a.licence_id
      where a.status = 'published' and a.deleted_at is null order by a.slug`,
  );
  const files = await q.query<{ id: string; asset_id: string; original_filename: string; public_key: string | null; size_bytes: string | number }>(
    `select f.id, f.asset_id, f.original_filename, f.public_key, f.size_bytes from asset_files f join assets a on a.id = f.asset_id
      where a.status = 'published' and a.deleted_at is null and f.deleted_at is null and f.published and f.purpose in ('delivery', 'bundle', 'preview', 'thumbnail')`,
  );
  const byAsset = new Map<string, typeof files>();
  for (const f of files) byAsset.set(f.asset_id, [...(byAsset.get(f.asset_id) ?? []), f]);
  const findings: AuditFinding[] = [];
  for (const a of assets) {
    const problems: string[] = [];
    if (!a.code || a.code === "unknown") problems.push("No known licence.");
    else if (!a.allows_download) problems.push(`The licence (${a.code}) doesn't allow downloads.`);
    if (!a.ownership_attested_at) problems.push("Ownership or redistribution rights aren't attested.");
    if (a.attribution_required && !a.attribution_text?.trim()) problems.push("The licence requires credit but there is no attribution text.");
    if (a.provenance_kind === "third_party" && !a.licence_source_url) problems.push("Third-party work without a link to its source or licence.");
    const own = byAsset.get(a.id) ?? [];
    if (!a.bundle_file_id) problems.push("No download bundle (ZIP with LICENSE and README).");
    else if (!own.some((f) => f.id === a.bundle_file_id)) problems.push("The download bundle isn't a published file.");
    for (const f of own) {
      if (!f.public_key) {
        problems.push(`${f.original_filename} is marked published but has no public copy.`);
        continue;
      }
      const head = await storage.head("public", f.public_key).catch(() => null);
      if (!head) problems.push(`${f.original_filename} is missing from the public bucket.`);
      else if (head.size !== Number(f.size_bytes)) problems.push(`${f.original_filename} is ${head.size} bytes in storage but ${f.size_bytes} on record.`);
      else if (opts.deep && f.id === a.bundle_file_id) {
        const bytes = await storage.get("public", f.public_key);
        let names: string[] = [];
        try {
          names = bytes ? Object.keys(unzipSync(bytes, { filter: (e) => /(^|\/)LICENSE\.txt$/i.test(e.name) })) : [];
        } catch {
          problems.push("The download bundle isn't a readable ZIP.");
        }
        if (bytes && !names.length && !problems.includes("The download bundle isn't a readable ZIP.")) problems.push("The download bundle has no LICENSE.txt.");
      }
    }
    if (problems.length) findings.push({ assetId: a.id, slug: a.slug, title: a.title, problems });
  }
  return { checked: assets.length, files: files.length, findings };
}
