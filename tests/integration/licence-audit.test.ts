import { strToU8, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditLicences } from "@/lib/assets/licence-audit";
import type { AssetStorage } from "@/lib/storage";
import { createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

/** Public bucket stand-in: key → bytes. */
function fakeStorage(objects: Record<string, Uint8Array>): AssetStorage {
  return {
    head: async (_b: string, key: string) => (objects[key] ? { size: objects[key]!.byteLength } : null),
    get: async (_b: string, key: string) => objects[key] ?? null,
  } as unknown as AssetStorage;
}

describe.each(TEST_DRIVERS)("licences audit (%s)", (driver) => {
  let t: TestDb;
  const good = zipSync({ "crate/LICENSE.txt": strToU8("CC0"), "crate/crate.glb": new Uint8Array(10) });
  const noLicence = zipSync({ "drum/drum.glb": new Uint8Array(10) });

  beforeAll(async () => {
    t = await createTestDb(driver);
    const lic = await t.db.query<{ id: string; code: string }>("select id, code from licences where code in ('cc0-1.0', 'cc-by-4.0')");
    const cc0 = lic.find((l) => l.code === "cc0-1.0")!.id;
    const ccBy = lic.find((l) => l.code === "cc-by-4.0")!.id;
    let n = 0;
    const make = async (slug: string, licence: string, extra: { provenance?: string; attribution?: string; bundle?: { bytes: number; key: string | null } }) => {
      const [a] = await t.db.query<{ id: string }>(
        `insert into assets (slug, title, asset_type, status, licence_id, ownership_attested_at, published_at, provenance_kind, attribution_text)
         values ($1, $1, 'model', 'draft', $2, now(), now(), $3::provenance_kind, $4) returning id`,
        [slug, licence, extra.provenance ?? "original", extra.attribution ?? null],
      );
      if (extra.bundle) {
        n++;
        const [f] = await t.db.query<{ id: string }>(
          `insert into asset_files (asset_id, purpose, storage_key, public_key, original_filename, format, mime, size_bytes, sha256)
           values ($1, 'bundle', $2, $3, $4, 'zip', 'application/zip', $5, $6) returning id`,
          [a!.id, `k/${n}`, extra.bundle.key, `${slug}.zip`, extra.bundle.bytes, String(n).repeat(64).slice(0, 64)],
        );
        await t.db.query("update assets set bundle_file_id = $2 where id = $1", [a!.id, f!.id]);
      }
      await t.db.query("update assets set status = 'published' where id = $1", [a!.id]);
    };
    await make("crate", cc0, { bundle: { bytes: good.byteLength, key: "p/crate.zip" } });
    await make("drum", cc0, { bundle: { bytes: noLicence.byteLength, key: "p/drum.zip" } });
    await make("credited", ccBy, { provenance: "third_party", bundle: { bytes: 99, key: "p/missing.zip" } });
    await make("bare", cc0, {});
  }, 60_000);

  afterAll(async () => {
    await t?.cleanup();
  });

  it("passes complete assets and lists exactly what is wrong with the others", async () => {
    const storage = fakeStorage({ "p/crate.zip": good, "p/drum.zip": noLicence });
    const shallow = await auditLicences(t.db, storage);
    expect(shallow.checked).toBe(4);
    const bySlug = Object.fromEntries(shallow.findings.map((f) => [f.slug, f.problems]));
    expect(bySlug.crate).toBeUndefined();
    expect(bySlug.drum).toBeUndefined(); // only found when bundles are opened
    expect(bySlug.credited).toEqual([
      "The licence requires credit but there is no attribution text.",
      "Third-party work without a link to its source or licence.",
      "credited.zip is missing from the public bucket.",
    ]);
    expect(bySlug.bare).toEqual(["No download bundle (ZIP with LICENSE and README)."]);
    const deep = await auditLicences(t.db, storage, { deep: true });
    expect(deep.findings.find((f) => f.slug === "drum")?.problems).toEqual(["The download bundle has no LICENSE.txt."]);
  });
});
