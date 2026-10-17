import { randomBytes, scryptSync } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { recordUsage, summariseUsage, usageTotals } from "@/lib/analytics/record";
import { checkLogin, LOGIN_LIMITS, recordLoginFailure } from "@/lib/auth/login-limits";
import { authenticate, createSession, createUser, resolveSession, setupOpen } from "@/lib/auth/sessions";
import { housekeeping, sendAlert, storageUse } from "@/lib/ops/maintenance";
import type { AssetStorage } from "@/lib/storage";
import { asRole, createTestDb, TEST_DRIVERS, type TestDb } from "../support/db";

const noStorage = { delete: async () => {} } as unknown as AssetStorage;

describe.each(TEST_DRIVERS)("security and operations (%s)", (driver) => {
  let t: TestDb;

  beforeAll(async () => {
    t = await createTestDb(driver);
  }, 60_000);

  afterAll(async () => {
    await t?.cleanup();
  });

  it("first-time setup closes once any account exists, even a disabled one", async () => {
    expect(await setupOpen(t.db, true)).toBe(true);
    const u = await createUser(t.db, { email: "first@example.test", password: "a long enough passphrase", displayName: "First", role: "admin" });
    await t.db.query("update users set disabled_at = now() where id = $1", [u.id]);
    expect(await setupOpen(t.db)).toBe(false);
    expect(await t.db.transaction((q) => setupOpen(q, true))).toBe(false);
  });

  it("rehashes a password made with the old, lighter scrypt cost at the next sign-in", async () => {
    const salt = randomBytes(16);
    const key = scryptSync("an older passphrase", salt, 64, { N: 1 << 15, r: 8, p: 1, maxmem: 128 * 1024 * 1024 });
    const old = ["scrypt", 1 << 15, 8, 1, salt.toString("base64"), key.toString("base64")].join("$");
    await t.db.query("insert into users (email, password_hash, display_name, role) values ('old@example.test', $1, 'Old', 'editor')", [old]);
    expect(await authenticate(t.db, "old@example.test", "an older passphrase")).not.toBeNull();
    const [row] = await t.db.query<{ password_hash: string }>("select password_hash from users where email = 'old@example.test'");
    expect(row!.password_hash.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(await authenticate(t.db, "old@example.test", "an older passphrase")).not.toBeNull();
  });

  it("ends a session 60 days after sign-in however active it is", async () => {
    const u = await createUser(t.db, { email: "busy@example.test", password: "a long enough passphrase", displayName: "Busy", role: "editor" });
    const signedIn = new Date("2026-01-01T00:00:00Z");
    const s = await createSession(t.db, u.id, null, signedIn);
    await t.db.query("update user_sessions set created_at = $2 where token_hash is not null and user_id = $1", [u.id, signedIn]);
    // Keep it alive with activity every 10 days.
    for (let d = 10; d < 60; d += 10) expect(await resolveSession(t.db, s.token, new Date(signedIn.getTime() + d * 86_400_000))).not.toBeNull();
    expect(await resolveSession(t.db, s.token, new Date(signedIn.getTime() + 60 * 86_400_000 + 1000))).toBeNull();
  });

  it("throttles sign-in guesses without letting strangers lock the owner out", async () => {
    const now = new Date("2026-10-17T10:00:00Z");
    const email = "owner-hash";
    // One address guessing: blocked after five failures for that email.
    for (let i = 0; i < LOGIN_LIMITS.pair.limit; i++) {
      expect(await checkLogin(t.db, "attacker-1", email, now)).toBeNull();
      await recordLoginFailure(t.db, "attacker-1", email, now);
    }
    expect(await checkLogin(t.db, "attacker-1", email, now)).not.toBeNull();
    // Many addresses guessing: the email is under attack, but a clean address (the owner) still gets through.
    for (let i = 0; i < LOGIN_LIMITS.email.limit; i++) await recordLoginFailure(t.db, `bot-${i % 40}`, email, now);
    expect(await checkLogin(t.db, "owners-laptop", email, now)).toBeNull();
    // Addresses that have failed a few times for it are stopped sooner while it's under attack.
    expect(await checkLogin(t.db, "bot-1", email, now)).not.toBeNull();
    // Every attempt counts against an address, whatever the email.
    for (let i = 0; i < LOGIN_LIMITS.address.limit; i++) expect(await checkLogin(t.db, "spray", `email-${i}`, now)).toBeNull();
    expect(await checkLogin(t.db, "spray", "another", now)).not.toBeNull();
  });

  it("cleans up old rate-limit windows, dedupe keys and expired sessions", async () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    await t.db.query("insert into rate_limits (bucket, window_start, hits) values ('test:old', $1, 1)", [old]);
    await t.db.query("insert into download_dedupe (key, created_at) values ('old-key', $1)", [old]);
    const [u] = await t.db.query<{ id: string }>("select id from users limit 1");
    await t.db.query("insert into user_sessions (user_id, token_hash, expires_at) values ($1, 'expired-hash', $2)", [u!.id, old]);
    const r = await housekeeping(t.db, noStorage);
    expect(r.rateLimitWindows).toBeGreaterThanOrEqual(1);
    expect(r.downloadDedupeKeys).toBe(1);
    expect(r.expiredSessions).toBeGreaterThanOrEqual(1);
    expect((await t.db.query("select 1 from user_sessions where token_hash = 'expired-hash'")).length).toBe(0);
  });

  it("estimates storage against the budget and alerts through the webhook", async () => {
    const [a] = await t.db.query<{ id: string }>("insert into assets (slug, title, asset_type, status) values ('big-thing', 'Big thing', 'model', 'draft') returning id");
    await t.db.query(
      `insert into asset_files (asset_id, purpose, storage_key, public_key, original_filename, format, mime, size_bytes, sha256)
       values ($1, 'delivery', 'k/1', 'p/1', 'a.glb', 'glb', 'model/gltf-binary', $2, $3)`,
      [a!.id, 900 * 1024 ** 2, "c".repeat(64)],
    );
    expect((await storageUse(t.db, undefined)).level).toBe("unset");
    const s = await storageUse(t.db, 2);
    expect(s.bytes).toBe(1800 * 1024 ** 2); // private original + public copy
    expect(s.level).toBe("warning");
    expect((await storageUse(t.db, 1)).level).toBe("over");
    const sent: string[] = [];
    const ok = await sendAlert("https://hooks.example/alert", "hello", (async (_url: string, init: RequestInit) => {
      sent.push(String(init.body));
      return new Response(null, { status: 204 });
    }) as typeof fetch);
    expect(ok).toBe(true);
    expect(JSON.parse(sent[0]!)).toEqual({ text: "hello", content: "hello" });
    expect(await sendAlert(undefined, "x")).toBe(false);
  });

  it("counts usage by day, event and subject, readable by staff only", async () => {
    const now = new Date();
    await recordUsage(t.db, { e: "page_view", s: "tool-seamless" }, now);
    await recordUsage(t.db, { e: "page_view", s: "tool-seamless" }, now);
    await recordUsage(t.db, { e: "export", s: "tool-seamless:png" }, now);
    await recordUsage(t.db, { e: "search", s: "assets" }, now);
    await recordUsage(t.db, { e: "download", s: "search" }, now);
    await recordUsage(t.db, { e: "preview", s: "asset:ok" }, now);
    await recordUsage(t.db, { e: "preview", s: "asset:error" }, now);
    await recordUsage(t.db, { e: "vital", s: "lcp:home", v: 1200, g: true }, now);
    await recordUsage(t.db, { e: "vital", s: "lcp:home", v: 3800, g: false }, now);
    const summary = summariseUsage(await usageTotals(t.db, 30, now));
    expect(summary.pageViews).toBe(2);
    expect(summary.searchToDownload).toBe(1);
    expect(summary.tools).toEqual([{ section: "tool-seamless", views: 2, exports: 1, rate: 0.5 }]);
    expect(summary.previews).toEqual([{ where: "asset", ok: 1, error: 1, errorRate: 0.5 }]);
    expect(summary.vitals).toEqual([{ metric: "lcp", samples: 2, average: 2500, goodShare: 0.5 }]);

    await expect(asRole(t.db, { role: "anon" }, (q) => q.query("select * from usage_daily"))).rejects.toThrow(/permission denied/i);
    const [editor] = await t.db.query<{ id: string }>("select id from users where role = 'editor' limit 1");
    expect((await asRole(t.db, { role: "editor", userId: editor!.id }, (q) => q.query("select * from usage_daily"))).length).toBeGreaterThan(0);
    await expect(asRole(t.db, { role: "editor", userId: editor!.id }, (q) => q.query("insert into usage_daily (day, event, subject, count) values (current_date, 'page_view', 'x', 99)"))).rejects.toThrow(
      /permission denied|row-level security/i,
    );
  });
});
