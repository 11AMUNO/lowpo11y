import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UploadError } from "@/lib/assets/uploads";
import { completeStarterUpload, createStarterUpload, publishWithFile, unpublishWithFile } from "@/lib/content/files";
import {
  ContentNotFoundError,
  createContent,
  deleteContent,
  getContent,
  listContent,
  setContentStatus,
  setCreatorApproved,
  SlugTakenError,
  updateContent,
} from "@/lib/content/repository";
import { publishChecklist } from "@/lib/content/checklist";
import { creatorInputSchema, resourceInputSchema, shaderInputSchema, starterInputSchema, tutorialInputSchema } from "@/lib/content/schemas";
import { LocalFilesystemStorage } from "@/lib/storage/local";
import { asRole, createTestDb, TEST_DRIVERS, txAs, type TestDb } from "../support/db";

const NOT_READY = /needs|must record/;

describe.each(TEST_DRIVERS)("shaders, starters, Learn and resources (%s)", (driver) => {
  let t: TestDb;
  let root: string;
  let storage: LocalFilesystemStorage;
  let adminId: string;
  let editorId: string;
  let mit: string;
  let unknown: string;
  const admin = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "admin", userId: adminId }, fn);
  const editor = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "editor", userId: editorId }, fn);
  const anon = <R>(fn: Parameters<typeof asRole<R>>[2]) => asRole(t.db, { role: "anon" }, fn);
  const adminTx = () => txAs(t.db, { role: "admin", userId: adminId });

  const completeShader = () =>
    shaderInputSchema.parse({
      slug: "psx-vertex-snap",
      title: "PSX vertex snap",
      summary: "Snaps vertices to a coarse grid.",
      engine: "threejs",
      engine_version_min: "r170",
      licence_id: mit,
      explanation_md: "Rounds clip-space positions.",
      setup_md: "Add the material.",
      limitations_md: "No skinning.",
      code: "void main() {}",
      code_language: "glsl",
      tested_at: "2026-10-17",
      tested_notes: "Live preview on this site",
    });

  beforeAll(async () => {
    t = await createTestDb(driver);
    root = await mkdtemp(path.join(tmpdir(), "lp-content-"));
    storage = new LocalFilesystemStorage(root, "http://localhost:3000", "c".repeat(40));
    const users = await t.db.query<{ id: string; role: string }>(
      "insert into users (email, password_hash, display_name, role) values ('a@c.test','x','Admin','admin'), ('e@c.test','x','Editor','editor') returning id, role",
    );
    adminId = users.find((u) => u.role === "admin")!.id;
    editorId = users.find((u) => u.role === "editor")!.id;
    const lic = await t.db.query<{ id: string; code: string }>("select id, code from licences where code in ('mit', 'unknown')");
    mit = lic.find((l) => l.code === "mit")!.id;
    unknown = lic.find((l) => l.code === "unknown")!.id;
  });

  afterAll(async () => {
    await t?.cleanup();
    await rm(root, { recursive: true, force: true });
  });

  describe("shaders", () => {
    it("refuse to publish until licensed, tested, explained and with code", async () => {
      const base = completeShader();
      const s = await editor((q) => createContent(q, "shader", { ...base, slug: "incomplete-shader", licence_id: unknown, tested_at: null, setup_md: "" }));
      await expect(admin((q) => setContentStatus(q, "shader", s.id, "published"))).rejects.toThrow(/known licence/);
      await admin((q) => updateContent(q, "shader", s.id, { licence_id: mit }));
      await expect(admin((q) => setContentStatus(q, "shader", s.id, "published"))).rejects.toThrow(/tested/);
      await admin((q) => updateContent(q, "shader", s.id, { tested_at: "2026-10-17" }));
      await expect(admin((q) => setContentStatus(q, "shader", s.id, "published"))).rejects.toThrow(/setup steps/);
      const row = await admin((q) => getContent(q, "shader", s.id));
      expect(publishChecklist("shader", row!, { licenceKnown: true }).filter((c) => !c.ok).map((c) => c.label)).toEqual(["Setup steps"]);
      await admin((q) => updateContent(q, "shader", s.id, { setup_md: "Drop it in." }));
      const published = await admin((q) => setContentStatus(q, "shader", s.id, "published"));
      expect(published.status).toBe("published");
      expect(published.published_at).not.toBeNull();
    });

    it("can't be inserted already published with nothing in them", async () => {
      await expect(t.db.query("insert into shader_resources (slug, title, engine, status) values ('bare', 'Bare', 'godot', 'published')")).rejects.toThrow(NOT_READY);
    });

    it("are published by admins only; editors move drafts to review", async () => {
      const s = await editor((q) => createContent(q, "shader", { ...completeShader(), slug: "editor-shader" }));
      expect((await editor((q) => setContentStatus(q, "shader", s.id, "review"))).status).toBe("review");
      await expect(editor((q) => setContentStatus(q, "shader", s.id, "published"))).rejects.toThrow(/row-level security|violates/i);
      await admin((q) => setContentStatus(q, "shader", s.id, "published"));
      // Published rows are out of an editor's reach.
      await expect(editor((q) => updateContent(q, "shader", s.id, { title: "Changed" }))).rejects.toThrow(ContentNotFoundError);
    });

    it("are visible to visitors only when published and not deleted", async () => {
      const slugs = (await anon((q) => q.query<{ slug: string }>("select slug from shader_resources order by slug"))).map((r) => r.slug);
      expect(slugs).toEqual(["editor-shader", "incomplete-shader"]);
      const s = await admin((q) => listContent(q, "shader", { search: "editor" }));
      await admin((q) => deleteContent(q, "shader", s[0]!.id));
      expect((await anon((q) => q.query<{ slug: string }>("select slug from shader_resources"))).map((r) => r.slug)).toEqual(["incomplete-shader"]);
      expect(await admin((q) => getContent(q, "shader", s[0]!.id))).toBeNull();
      await expect(admin((q) => deleteContent(q, "shader", s[0]!.id))).rejects.toThrow(ContentNotFoundError);
    });

    it("reject duplicate and malformed slugs", async () => {
      await expect(admin((q) => createContent(q, "shader", { ...completeShader(), slug: "incomplete-shader" }))).rejects.toThrow(SlugTakenError);
      await expect(t.db.query("insert into shader_resources (slug, title, engine) values ('Bad Slug', 'x', 'godot')")).rejects.toThrow(/slug_format/);
      expect(() => shaderInputSchema.parse({ ...completeShader(), slug: "no--doubles" })).toThrow();
    });

    it("publish with a download bundle, replaced on republish and removed on unpublish", async () => {
      const s = await admin((q) => createContent(q, "shader", completeShader()));
      const published = await publishWithFile(adminTx(), storage, "shader", s.id, "https://lowpo11y.test");
      expect(published.status).toBe("published");
      const [row] = await t.db.query<{ file_public_key: string; file_name: string; file_size_bytes: string; file_sha256: string }>(
        "select file_public_key, file_name, file_size_bytes, file_sha256 from shader_resources where id = $1",
        [s.id],
      );
      expect(row!.file_name).toBe("psx-vertex-snap.zip");
      const zip = await storage.get("public", row!.file_public_key);
      expect(zip!.byteLength).toBe(Number(row!.file_size_bytes));
      const files = unzipSync(zip!);
      expect(Object.keys(files).sort()).toEqual(["psx-vertex-snap/LICENSE.txt", "psx-vertex-snap/README.md", "psx-vertex-snap/psx-vertex-snap.glsl"]);
      const readme = new TextDecoder().decode(files["psx-vertex-snap/README.md"]);
      expect(readme).toContain("Tested with three.js r170 on 2026-10-17 — Live preview on this site.");
      expect(readme).toContain("https://lowpo11y.test/shaders/psx-vertex-snap");
      expect(new TextDecoder().decode(files["psx-vertex-snap/LICENSE.txt"])).toContain("MIT");

      await admin((q) => updateContent(q, "shader", s.id, { code: "void main() { gl_Position = vec4(0.0); }" }));
      await publishWithFile(adminTx(), storage, "shader", s.id, "https://lowpo11y.test");
      const [next] = await t.db.query<{ file_public_key: string }>("select file_public_key from shader_resources where id = $1", [s.id]);
      expect(next!.file_public_key).not.toBe(row!.file_public_key);
      expect(await storage.head("public", row!.file_public_key)).toBeNull();

      const down = await unpublishWithFile(adminTx(), storage, "shader", s.id);
      expect(down).toMatchObject({ status: "draft", file_public_key: null });
      expect(await storage.head("public", next!.file_public_key)).toBeNull();
    });

    it("leave no public file behind when publishing is refused", async () => {
      const s = await admin((q) => createContent(q, "shader", { ...completeShader(), slug: "no-limits", limitations_md: "" }));
      await expect(publishWithFile(adminTx(), storage, "shader", s.id, "https://lowpo11y.test")).rejects.toThrow(/limitations/);
      const [row] = await t.db.query<{ file_public_key: string | null; status: string }>("select file_public_key, status from shader_resources where id = $1", [s.id]);
      expect(row).toEqual({ file_public_key: null, status: "draft" });
    });
  });

  describe("starter projects", () => {
    const project = () => zipSync({ "project.godot": new TextEncoder().encode("[application]\n"), "scenes/main.tscn": new Uint8Array([1, 2, 3]), "scripts/player.gd": new TextEncoder().encode("extends Node\n") });

    async function stage(starterId: string, filename: string, bytes: Uint8Array) {
      const { id } = await createStarterUpload(adminTx(), storage, adminId, starterId, { filename, size: bytes.byteLength, contentType: "application/zip" }, 50 * 1024 * 1024);
      const [s] = await t.db.query<{ staging_key: string }>("select staging_key from upload_sessions where id = $1", [id]);
      await storage.put("private", s!.staging_key, bytes, { contentType: "application/zip" });
      return id;
    }

    it("need a verified ZIP, a licence, a test date and a description to publish", async () => {
      const s = await admin((q) =>
        createContent(q, "starter", starterInputSchema.parse({ slug: "fps-starter", title: "FPS starter", engine: "godot", engine_versions: "4.3", licence_id: mit, tested_at: "2026-10-17", description_md: "A first-person controller." })),
      );
      await expect(publishWithFile(adminTx(), storage, "starter", s.id, "https://lowpo11y.test")).rejects.toThrow(/download file/);

      const bytes = project();
      const filed = await completeStarterUpload(adminTx(), storage, adminId, await stage(s.id, "FPS Starter.zip", bytes));
      expect(filed.file_name).toBe("FPS Starter.zip");
      expect(Number(filed.file_size_bytes)).toBe(bytes.byteLength);
      expect(await storage.head("private", filed.file_key)).toMatchObject({ size: bytes.byteLength });

      const published = await publishWithFile(adminTx(), storage, "starter", s.id, "https://lowpo11y.test");
      expect(published.status).toBe("published");
      const [row] = await t.db.query<{ file_public_key: string }>("select file_public_key from starter_projects where id = $1", [s.id]);
      expect(await storage.get("public", row!.file_public_key)).toEqual(bytes);

      await unpublishWithFile(adminTx(), storage, "starter", s.id);
      expect(await storage.head("public", row!.file_public_key)).toBeNull();
      expect(await storage.head("private", filed.file_key)).not.toBeNull();
    });

    it("reject archives with binaries, unsafe paths or no ZIP at all", async () => {
      const [s] = await t.db.query<{ id: string }>("insert into starter_projects (slug, title, engine) values ('bad-zips', 'Bad', 'godot') returning id");
      const binary = zipSync({ "game.exe": new Uint8Array([0x4d, 0x5a]) });
      await expect(completeStarterUpload(adminTx(), storage, adminId, await stage(s!.id, "a.zip", binary))).rejects.toThrow(/Binaries and shell scripts/);
      await expect(completeStarterUpload(adminTx(), storage, adminId, await stage(s!.id, "b.zip", zipSync({ "build.sh": new Uint8Array([35]) })))).rejects.toThrow(/build\.sh/);
      await expect(completeStarterUpload(adminTx(), storage, adminId, await stage(s!.id, "c.zip", new TextEncoder().encode("not a zip at all")))).rejects.toThrow(/isn't a ZIP/);
      await expect(createStarterUpload(adminTx(), storage, adminId, s!.id, { filename: "project.rar", size: 10, contentType: "application/zip" }, 1000)).rejects.toThrow(UploadError);
      const failed = await t.db.query<{ status: string }>("select status from upload_sessions where target_id = $1 and status = 'failed'", [s!.id]);
      expect(failed).toHaveLength(3);
    });

    it("uploads are tied to the person who started them", async () => {
      const [s] = await t.db.query<{ id: string }>("select id from starter_projects where slug = 'bad-zips'");
      const id = await stage(s!.id, "mine.zip", project());
      await expect(completeStarterUpload(txAs(t.db, { role: "editor", userId: editorId }), storage, editorId, id)).rejects.toThrow(/not found/i);
    });
  });

  describe("Learn", () => {
    let creatorId: string;

    it("creators need a description, a link and a review date, and only admins approve", async () => {
      const c = await editor((q) => createContent(q, "creator", creatorInputSchema.parse({ slug: "test-channel", name: "Test Channel", categories: ["Godot Rendering"] })));
      creatorId = c.id;
      await expect(admin((q) => setCreatorApproved(q, c.id, true))).rejects.toThrow(/description/);
      await editor((q) => updateContent(q, "creator", c.id, { description: "Short Godot rendering lessons.", youtube_channel_url: "https://www.youtube.com/@example", last_reviewed_at: "2026-10-17" }));
      await expect(editor((q) => setCreatorApproved(q, c.id, true))).rejects.toThrow(/row-level security|violates|not found/i);
      expect(await anon((q) => q.query("select id from tutorial_creators"))).toHaveLength(0);
      expect((await admin((q) => setCreatorApproved(q, c.id, true))).approved).toBe(true);
      expect(await anon((q) => q.query("select id from tutorial_creators"))).toHaveLength(1);
    });

    it("tutorials need a video, a summary, a review date and an approved creator", async () => {
      const input = tutorialInputSchema.parse({ slug: "lighting-basics", title: "Lighting basics", youtube_video_id: "https://youtu.be/dQw4w9WgXcQ?t=3", topic: "Godot Rendering", difficulty: "beginner", engine: "godot" });
      expect(input.youtube_video_id).toBe("dQw4w9WgXcQ");
      const tut = await editor((q) => createContent(q, "tutorial", input));
      await expect(admin((q) => setContentStatus(q, "tutorial", tut.id, "published"))).rejects.toThrow(/summary/);
      await editor((q) => updateContent(q, "tutorial", tut.id, { summary: "Set up lights.", last_reviewed_at: "2026-10-17" }));
      await expect(admin((q) => setContentStatus(q, "tutorial", tut.id, "published"))).rejects.toThrow(/approved creator/);
      await editor((q) => updateContent(q, "tutorial", tut.id, { creator_id: creatorId }));
      await expect(editor((q) => setContentStatus(q, "tutorial", tut.id, "published"))).rejects.toThrow(/row-level security|violates/i);
      expect((await admin((q) => setContentStatus(q, "tutorial", tut.id, "published"))).status).toBe("published");
      const listed = await admin((q) => listContent(q, "tutorial", { status: "published" }));
      expect(listed.map((r) => [r.slug, r.creator_name])).toEqual([["lighting-basics", "Test Channel"]]);
    });

    it("unapproving a creator takes their tutorials down", async () => {
      await admin((q) => setCreatorApproved(q, creatorId, false));
      const [tut] = await t.db.query<{ status: string; published_at: string | null }>("select status, published_at from tutorials where slug = 'lighting-basics'");
      expect(tut).toEqual({ status: "draft", published_at: null });
      expect(await anon((q) => q.query("select id from tutorials"))).toHaveLength(0);
    });

    it("deleting a creator unpublishes their tutorials instead of orphaning them", async () => {
      const c = await admin((q) =>
        createContent(q, "creator", creatorInputSchema.parse({ slug: "leaving-channel", name: "Leaving", description: "Gone soon.", website_url: "https://leaving.test", last_reviewed_at: "2026-10-17" })),
      );
      await admin((q) => setCreatorApproved(q, c.id, true));
      const tut = await admin((q) =>
        createContent(q, "tutorial", tutorialInputSchema.parse({ slug: "last-video", title: "Last video", creator_id: c.id, external_url: "https://leaving.test/v", summary: "Bye.", last_reviewed_at: "2026-10-17" })),
      );
      await admin((q) => setContentStatus(q, "tutorial", tut.id, "published"));
      await admin((q) => deleteContent(q, "creator", c.id));
      const [row] = await t.db.query<{ status: string; creator_id: string | null }>("select status, creator_id from tutorials where id = $1", [tut.id]);
      expect(row).toEqual({ status: "draft", creator_id: null });
    });

    it("rejects links that aren't YouTube videos", () => {
      expect(() => tutorialInputSchema.parse({ slug: "x-y", title: "Nope", youtube_video_id: "https://vimeo.com/123" })).toThrow(/YouTube/);
    });
  });

  describe("external resources", () => {
    it("need an https link, a description and a review date; admins publish", async () => {
      expect(() => resourceInputSchema.parse({ slug: "insecure", title: "Insecure", url: "http://example.com", category: "tools" })).toThrow(/https/);
      const r = await editor((q) => createContent(q, "resource", resourceInputSchema.parse({ slug: "godot-docs", title: "Godot docs", url: "https://docs.godotengine.org/", category: "docs" })));
      await expect(admin((q) => setContentStatus(q, "resource", r.id, "published"))).rejects.toThrow(/description/);
      await editor((q) => updateContent(q, "resource", r.id, { description: "The official manual.", last_reviewed_at: "2026-10-17" }));
      await expect(editor((q) => setContentStatus(q, "resource", r.id, "published"))).rejects.toThrow(/row-level security|violates/i);
      await admin((q) => setContentStatus(q, "resource", r.id, "published"));
      expect((await anon((q) => q.query<{ slug: string }>("select slug from external_resources"))).map((x) => x.slug)).toEqual(["godot-docs"]);
      await t.db.query("update external_resources set url = 'http://insecure.test' where id = $1", [r.id]).then(
        () => expect.unreachable(),
        (e: Error) => expect(e.message).toMatch(/https link/),
      );
    });

    it("can't be written by visitors", async () => {
      await expect(anon((q) => q.query("insert into external_resources (slug, title, url, category) values ('x-y', 'X', 'https://x.test', 'docs')"))).rejects.toThrow(/permission denied|row-level security/i);
    });
  });
});
