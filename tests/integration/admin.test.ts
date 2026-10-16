import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adminListSchema, auditFor, findAssetsForPicker, listAdminAssets, listAudit, listMessages } from "@/lib/assets/admin";
import { createAsset, getAssetById, updateAsset } from "@/lib/assets/repository";
import { assetInputSchema } from "@/lib/assets/schemas";
import { audit } from "@/lib/audit";
import { contactSchema, saveContactMessage } from "@/lib/contact";
import { asRole, createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

describe.each(TEST_DRIVERS)("admin data rules (%s)", (driver) => {
  let t: TestDb;
  let adminId: string;
  let editorId: string;
  let cc0: string;
  let ccBy: string;
  const admin = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "admin", userId: adminId }, fn);
  const editor = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "editor", userId: editorId }, fn);
  const anon = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "anon" }, fn);

  beforeAll(async () => {
    t = await createTestDb(driver);
    const users = await t.db.query<{ id: string; role: string }>(
      "insert into users (email, password_hash, display_name, role) values ('a@x.test','x','Ada Admin','admin'), ('e@x.test','x','Eddie Editor','editor') returning id, role",
    );
    adminId = users.find((u) => u.role === "admin")!.id;
    editorId = users.find((u) => u.role === "editor")!.id;
    const lic = await t.db.query<{ id: string; code: string }>("select id, code from licences where code in ('cc0-1.0', 'cc-by-4.0')");
    cc0 = lic.find((l) => l.code === "cc0-1.0")!.id;
    ccBy = lic.find((l) => l.code === "cc-by-4.0")!.id;
  }, 60_000);

  afterAll(async () => {
    await t?.cleanup();
  });

  describe("rights attestation", () => {
    it("is stamped with who and when, and cleared when the licence changes", async () => {
      const a = await admin((q) => createAsset(q, adminId, assetInputSchema.parse({ title: "Attest me", assetType: "model", licenceId: cc0 })));
      const attested = await admin((q) => updateAsset(q, adminId, a.id, { attest: true }));
      expect(attested.ownership_attested_by).toBe(adminId);
      expect(attested.ownership_attested_at).not.toBeNull();

      // Saving the same licence keeps the confirmation.
      const same = await admin((q) => updateAsset(q, adminId, a.id, { licenceId: cc0, title: "Attest me again" }));
      expect(same.ownership_attested_at).toEqual(attested.ownership_attested_at);

      // A different licence clears it…
      const changed = await admin((q) => updateAsset(q, adminId, a.id, { licenceId: ccBy }));
      expect(changed.ownership_attested_at).toBeNull();
      expect(changed.ownership_attested_by).toBeNull();

      // …and confirming together with a licence change restamps it for the new licence.
      const reconfirmed = await editor((q) => updateAsset(q, editorId, a.id, { licenceId: cc0, attest: true }));
      expect(reconfirmed.ownership_attested_by).toBe(editorId);
      expect(reconfirmed.licence_id).toBe(cc0);

      const withdrawn = await admin((q) => updateAsset(q, adminId, a.id, { attest: false }));
      expect(withdrawn.ownership_attested_at).toBeNull();
    });

    it("lets editors move drafts to review but not publish", async () => {
      const a = await editor((q) => createAsset(q, editorId, assetInputSchema.parse({ title: "Editor draft", assetType: "texture" })));
      const review = await editor((q) => updateAsset(q, editorId, a.id, { status: "review", licenceId: cc0, attest: true }));
      expect(review.status).toBe("review");
      await expect(editor((q) => q.query("update assets set status = 'published' where id = $1", [a.id]))).rejects.toThrow(/row-level security/);
      expect((await admin((q) => getAssetById(q, a.id)))!.status).toBe("review");
    });
  });

  describe("admin lists", () => {
    it("filter by status, type, text and problems", async () => {
      await admin((q) => createAsset(q, adminId, assetInputSchema.parse({ title: "Brass lamp 50%_off", assetType: "model" })));
      const all = await admin((q) => listAdminAssets(q, adminListSchema.parse({})));
      expect(all.total).toBeGreaterThanOrEqual(3);
      const reviews = await admin((q) => listAdminAssets(q, adminListSchema.parse({ status: "review" })));
      expect(reviews.items.map((i) => i.title)).toEqual(["Editor draft"]);
      const textures = await admin((q) => listAdminAssets(q, adminListSchema.parse({ type: "texture" })));
      expect(textures.items.every((i) => i.asset_type === "texture")).toBe(true);
      // LIKE wildcards in the search box are literal.
      const literal = await admin((q) => listAdminAssets(q, adminListSchema.parse({ q: "50%_" })));
      expect(literal.items.map((i) => i.title)).toEqual(["Brass lamp 50%_off"]);
      const noLicence = await admin((q) => listAdminAssets(q, adminListSchema.parse({ problem: "licence" })));
      expect(noLicence.items.map((i) => i.title)).toContain("Brass lamp 50%_off");
      const noFiles = await admin((q) => listAdminAssets(q, adminListSchema.parse({ problem: "files" })));
      expect(noFiles.total).toBe(all.total);
      expect((await admin((q) => findAssetsForPicker(q, "brass"))).map((i) => i.title)).toEqual(["Brass lamp 50%_off"]);
    });

    it("are invisible to anonymous visitors", async () => {
      const r = await anon((q) => listAdminAssets(q, adminListSchema.parse({})));
      expect(r.total).toBe(0);
    });
  });

  describe("audit trail", () => {
    it("shows actor names to admins only", async () => {
      const [a] = await t.db.query<{ id: string }>("select id from assets where title = 'Attest me again'");
      await admin((q) => audit(q, adminId, "asset.update", "asset", a!.id, { fields: "title" }));
      const entries = await admin((q) => auditFor(q, "asset", a!.id));
      expect(entries[0]).toMatchObject({ action: "asset.update", actor_name: "Ada Admin" });
      expect(await editor((q) => auditFor(q, "asset", a!.id))).toEqual([]);
      const filtered = await admin((q) => listAudit(q, { action: "asset.", page: 1 }));
      expect(filtered.items.length).toBeGreaterThan(0);
    });

    it("exposes display names to staff only, never to visitors", async () => {
      expect((await editor((q) => q.query<{ display_name: string }>("select display_name from user_names order by display_name"))).map((r) => r.display_name)).toEqual([
        "Ada Admin",
        "Eddie Editor",
      ]);
      await expect(anon((q) => q.query("select * from user_names"))).rejects.toThrow(/permission denied/);
      await expect(editor((q) => q.query("select email from users"))).rejects.toThrow(/permission denied/);
    });
  });

  describe("contact messages", () => {
    it("are stored by the service, read by staff, and validated", async () => {
      const input = contactSchema.parse({ kind: "takedown", name: "Holder", email: "holder@example.test", subject: "Mine", message: "This listing uses my work.", pagePath: "/assets/x" });
      await saveContactMessage(t.db, input);
      const msgs = await editor((q) => listMessages(q));
      expect(msgs).toHaveLength(1);
      expect(msgs[0]).toMatchObject({ kind: "takedown", status: "new", page_url: "/assets/x" });
      expect(await anon((q) => q.query("select * from contact_messages")).catch(() => [])).toEqual([]);
      expect(contactSchema.safeParse({ ...input, pagePath: "https://evil.example" }).success).toBe(false);
      expect(contactSchema.parse({ ...input, website: "http://spam" }).website).toBe("bot");
    });
  });
});
