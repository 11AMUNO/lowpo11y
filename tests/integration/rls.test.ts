import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "@/lib/db/migrate";
import { asRole, createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

async function expectDenied(p: Promise<unknown>) {
  await expect(p).rejects.toThrow(/permission denied|row-level security|violates/i);
}

describe.each(TEST_DRIVERS)("schema and row-level security (%s)", (driver) => {
  let t: TestDb;
  let editorId: string;
  let adminId: string;
  let userId: string;
  let cc0: string;
  let unknown: string;
  let publishedId: string;
  let draftId: string;

  beforeAll(async () => {
    t = await createTestDb(driver);
    const { db } = t;
    const users = await db.query<{ id: string; role: string }>(
      `insert into users (email, password_hash, display_name, role) values
         ('editor@example.test', 'x', 'Editor', 'editor'),
         ('admin@example.test', 'x', 'Admin', 'admin'),
         ('user@example.test', 'x', 'User', 'user')
       returning id, role`,
    );
    editorId = users.find((u) => u.role === "editor")!.id;
    adminId = users.find((u) => u.role === "admin")!.id;
    userId = users.find((u) => u.role === "user")!.id;
    const lic = await db.query<{ id: string; code: string }>("select id, code from licences");
    cc0 = lic.find((l) => l.code === "cc0-1.0")!.id;
    unknown = lic.find((l) => l.code === "unknown")!.id;

    const [pub] = await db.query<{ id: string }>(
      `insert into assets (slug, title, asset_type, status, licence_id, ownership_attested_at, published_at)
       values ('rusty-barrel', 'Rusty barrel', 'model', 'published', $1, now(), now()) returning id`,
      [cc0],
    );
    publishedId = pub!.id;
    const [draft] = await db.query<{ id: string }>(
      `insert into assets (slug, title, asset_type, status) values ('secret-crate', 'Secret crate', 'model', 'draft') returning id`,
    );
    draftId = draft!.id;
    await db.query(
      `insert into assets (slug, title, asset_type, status, licence_id, ownership_attested_at, published_at, deleted_at)
       values ('removed-thing', 'Removed thing', 'model', 'published', $1, now(), now(), now())`,
      [cc0],
    );
    await db.query(
      `insert into asset_files (asset_id, purpose, storage_key, original_filename, format, mime, size_bytes, sha256, published)
       values ($1, 'delivery', 'assets/a/delivery/1.glb', 'barrel.glb', 'glb', 'model/gltf-binary', 1234, $3, true),
              ($1, 'source', 'assets/a/source/1.blend', 'barrel.blend', 'blend', 'application/octet-stream', 99, $3, false),
              ($2, 'delivery', 'assets/b/delivery/1.glb', 'crate.glb', 'glb', 'model/gltf-binary', 10, $3, true)`,
      [publishedId, draftId, "a".repeat(64)],
    );
  });

  afterAll(async () => {
    await t?.cleanup();
  });

  it("re-running migrations is a no-op", async () => {
    const result = await migrate(t.db);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThanOrEqual(2);
  });

  it("seeds reference licences including a download-blocking unknown", async () => {
    const rows = await asRole(t.db, { role: "anon" }, (q) =>
      q.query<{ code: string; allows_download: boolean }>("select code, allows_download from licences order by sort_order"),
    );
    expect(rows.map((r) => r.code)).toContain("cc0-1.0");
    expect(rows.find((r) => r.code === "unknown")?.allows_download).toBe(false);
  });

  describe("anonymous visitor", () => {
    it("sees only published, non-deleted assets", async () => {
      const rows = await asRole(t.db, { role: "anon" }, (q) => q.query<{ slug: string }>("select slug from assets order by slug"));
      expect(rows.map((r) => r.slug)).toEqual(["rusty-barrel"]);
    });

    it("sees only published files of published assets", async () => {
      const rows = await asRole(t.db, { role: "anon" }, (q) => q.query<{ original_filename: string }>("select original_filename from asset_files"));
      expect(rows.map((r) => r.original_filename)).toEqual(["barrel.glb"]);
    });

    it("cannot create, edit or delete assets", async () => {
      await expectDenied(asRole(t.db, { role: "anon" }, (q) => q.query("insert into assets (slug, title, asset_type) values ('x', 'X', 'model')")));
      await expectDenied(asRole(t.db, { role: "anon" }, (q) => q.query("update assets set title = 'pwned'")));
      await expectDenied(asRole(t.db, { role: "anon" }, (q) => q.query("delete from assets")));
      const [row] = await t.db.query<{ title: string }>("select title from assets where id = $1", [publishedId]);
      expect(row?.title).toBe("Rusty barrel");
    });

    it("cannot read accounts, sessions or operational tables", async () => {
      for (const table of ["users", "user_sessions", "rate_limits", "audit_log", "upload_sessions", "contact_messages"]) {
        await expectDenied(asRole(t.db, { role: "anon" }, (q) => q.query(`select * from ${table}`)));
      }
    });
  });

  describe("signed-in user without staff role", () => {
    it("sees the public catalogue only and cannot write it", async () => {
      const ctx = { role: "user" as const, userId };
      const rows = await asRole(t.db, ctx, (q) => q.query<{ slug: string }>("select slug from assets"));
      expect(rows.map((r) => r.slug)).toEqual(["rusty-barrel"]);
      await expectDenied(asRole(t.db, ctx, (q) => q.query("insert into assets (slug, title, asset_type) values ('mine', 'Mine', 'model')")));
    });

    it("only sees their own private presets", async () => {
      await t.db.query(
        `insert into presets (user_id, tool_slug, name, config_json) values ($1, 'converter', 'mine', '{}'), ($2, 'converter', 'theirs', '{}')`,
        [userId, editorId],
      );
      const rows = await asRole(t.db, { role: "user", userId }, (q) => q.query<{ name: string }>("select name from presets"));
      expect(rows.map((r) => r.name)).toEqual(["mine"]);
    });
  });

  describe("editor", () => {
    const ctx = () => ({ role: "editor" as const, userId: editorId });

    it("sees drafts and can create and edit them", async () => {
      const rows = await asRole(t.db, ctx(), (q) => q.query<{ slug: string }>("select slug from assets where deleted_at is null order by slug"));
      expect(rows.map((r) => r.slug)).toEqual(["rusty-barrel", "secret-crate"]);
      await asRole(t.db, ctx(), (q) => q.query("insert into assets (slug, title, asset_type, status) values ('editor-draft', 'Editor draft', 'texture', 'draft')"));
      await asRole(t.db, ctx(), (q) => q.query("update assets set title = 'Secret crate v2' where id = $1", [draftId]));
      const [row] = await t.db.query<{ title: string }>("select title from assets where id = $1", [draftId]);
      expect(row?.title).toBe("Secret crate v2");
    });

    it("cannot publish or edit published assets", async () => {
      await expectDenied(
        asRole(t.db, ctx(), (q) =>
          q.query("update assets set status = 'published', licence_id = $2, ownership_attested_at = now(), published_at = now() where id = $1", [draftId, cc0]),
        ),
      );
      const touched = await asRole(t.db, ctx(), (q) => q.query("update assets set title = 'Edited' where id = $1 returning id", [publishedId]));
      expect(touched).toEqual([]);
    });

    it("cannot change the files, tags or pack membership of published items, only of drafts", async () => {
      const files = (id: string) => asRole(t.db, ctx(), (q) => q.query<{ id: string }>("update asset_files set sort_order = 7 where asset_id = $1 returning id", [id]));
      expect(await files(publishedId)).toEqual([]);
      expect(await asRole(t.db, ctx(), (q) => q.query("delete from asset_files where asset_id = $1 returning id", [publishedId]))).toEqual([]);
      await expectDenied(
        asRole(t.db, ctx(), (q) =>
          q.query(
            "insert into asset_files (asset_id, purpose, storage_key, original_filename, format, mime, size_bytes, sha256) values ($1, 'source', 'assets/x/source/2.bin', 'x.bin', 'bin', 'application/octet-stream', 1, $2)",
            [publishedId, "b".repeat(64)],
          ),
        ),
      );
      expect(await files(draftId)).toHaveLength(1);
      const [tag] = await t.db.query<{ id: string }>("insert into tags (slug, name) values ('rusty', 'Rusty') returning id");
      await expectDenied(asRole(t.db, ctx(), (q) => q.query("insert into asset_tags (asset_id, tag_id) values ($1, $2)", [publishedId, tag!.id])));
      await asRole(t.db, ctx(), (q) => q.query("insert into asset_tags (asset_id, tag_id) values ($1, $2)", [draftId, tag!.id]));
      const [pack] = await t.db.query<{ id: string }>("insert into collections (slug, title, status, published_at) values ('live-pack', 'Live pack', 'published', now()) returning id");
      await expectDenied(asRole(t.db, ctx(), (q) => q.query("insert into collection_assets (collection_id, asset_id) values ($1, $2)", [pack!.id, publishedId])));
      // Admins still can.
      await asRole(t.db, { role: "admin", userId: adminId }, (q) => q.query("insert into collection_assets (collection_id, asset_id) values ($1, $2)", [pack!.id, publishedId]));
      expect(await asRole(t.db, { role: "admin", userId: adminId }, (q) => q.query("update asset_files set sort_order = 0 where asset_id = $1 returning id", [publishedId]))).toHaveLength(2);
    });

    it("can write audit entries only as themselves", async () => {
      await asRole(t.db, ctx(), (q) => q.query("insert into audit_log (actor_id, action, target_type) values ($1, 'test', 'asset')", [editorId]));
      await expectDenied(asRole(t.db, ctx(), (q) => q.query("insert into audit_log (actor_id, action, target_type) values ($1, 'forged', 'asset')", [adminId])));
    });
  });

  describe("admin", () => {
    const ctx = () => ({ role: "admin" as const, userId: adminId });

    it("can publish a draft with a known licence and ownership attestation", async () => {
      await asRole(t.db, ctx(), (q) =>
        q.query("update assets set status = 'published', licence_id = $2, ownership_attested_at = now(), published_at = now() where id = $1", [draftId, cc0]),
      );
      const rows = await asRole(t.db, { role: "anon" }, (q) => q.query<{ slug: string }>("select slug from assets order by slug"));
      expect(rows.map((r) => r.slug)).toEqual(["rusty-barrel", "secret-crate"]);
    });

    it("cannot publish with an unknown licence or without attestation", async () => {
      const [a] = await t.db.query<{ id: string }>("insert into assets (slug, title, asset_type) values ('needs-rights', 'Needs rights', 'texture') returning id");
      await expect(
        asRole(t.db, ctx(), (q) =>
          q.query("update assets set status = 'published', licence_id = $2, ownership_attested_at = now(), published_at = now() where id = $1", [a!.id, unknown]),
        ),
      ).rejects.toThrow(/known licence/);
      await expect(
        asRole(t.db, ctx(), (q) => q.query("update assets set status = 'published', licence_id = $2, published_at = now() where id = $1", [a!.id, cc0])),
      ).rejects.toThrow(/assets_published_requirements/);
    });
  });

  it("indexes tag names for full-text search", async () => {
    const [tag] = await t.db.query<{ id: string }>("select id from tags where slug = 'industrial'");
    await t.db.query("insert into asset_tags (asset_id, tag_id) values ($1, $2)", [publishedId, tag!.id]);
    const rows = await asRole(t.db, { role: "anon" }, (q) =>
      q.query<{ slug: string }>("select slug from assets where search_tsv @@ websearch_to_tsquery('english', $1)", ["industrial barrels"]),
    );
    expect(rows.map((r) => r.slug)).toEqual(["rusty-barrel"]);
  });

  it("accepts array parameters for facet filters", async () => {
    await t.db.query("update assets set formats = $2::text[] where id = $1", [publishedId, ["glb", "fbx"]]);
    const rows = await asRole(t.db, { role: "anon" }, (q) =>
      q.query<{ slug: string }>("select slug from assets where formats && $1::text[]", [["fbx", "obj"]]),
    );
    expect(rows.map((r) => r.slug)).toEqual(["rusty-barrel"]);
  });
});
