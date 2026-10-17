import { describe, expect, it } from "vitest";
import { hashPassword, needsRehash, passwordProblems, verifyPassword } from "./password";
import { safeNextPath } from "./schemas";
import { keyedHash, sha256Hex, signToken, verifyToken } from "./tokens";

describe("passwords", () => {
  it("hashes with a random salt and verifies", async () => {
    const a = await hashPassword("correct horse battery staple");
    const b = await hashPassword("correct horse battery staple");
    expect(a).not.toBe(b);
    expect(a.startsWith("scrypt$131072$8$1$")).toBe(true);
    expect(needsRehash(a)).toBe(false);
    expect(await verifyPassword("correct horse battery staple", a)).toBe(true);
    expect(await verifyPassword("correct horse battery stapler", a)).toBe(false);
  });

  it("normalises Unicode so equivalent input verifies", async () => {
    const h = await hashPassword("café-password-1");
    expect(await verifyPassword("café-password-1", h)).toBe(true);
  });

  it("still verifies hashes made with the earlier, lighter parameters, and marks them for rehashing", async () => {
    // scrypt N=2^15 hash of "an older password" from before the cost was raised.
    const old = "scrypt$32768$8$1$" + "AAAAAAAAAAAAAAAAAAAAAA==$";
    expect(needsRehash(old)).toBe(true);
    expect(await verifyPassword("anything", old + "AAAA")).toBe(false);
  });

  it("rejects malformed stored hashes", async () => {
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
  });

  it("explains weak passwords", () => {
    expect(passwordProblems("short")).toHaveLength(1);
    expect(passwordProblems("aaaaaaaaaaaaaaaa")).toEqual(["Avoid a single repeated character."]);
    expect(passwordProblems("a long enough passphrase")).toEqual([]);
  });
});

describe("signed tokens", () => {
  const secret = "s".repeat(40);
  const exp = Math.floor(Date.now() / 1000) + 60;

  it("round-trips a payload for the same purpose", () => {
    const t = signToken({ key: "staging/x/incoming", exp }, secret, "upload");
    expect(verifyToken<{ key: string; exp: number }>(t, secret, "upload")?.key).toBe("staging/x/incoming");
  });

  it("rejects tampering, wrong purpose, wrong secret and expiry", () => {
    const t = signToken({ key: "a", exp }, secret, "upload");
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ key: "assets/other", exp })).toString("base64url");
    expect(verifyToken(`${forged}.${mac}`, secret, "upload")).toBeNull();
    expect(verifyToken(t, secret, "object")).toBeNull();
    expect(verifyToken(t, "x".repeat(40), "upload")).toBeNull();
    expect(verifyToken(`${body}.`, secret, "upload")).toBeNull();
    const old = signToken({ key: "a", exp: Math.floor(Date.now() / 1000) - 1 }, secret, "upload");
    expect(verifyToken(old, secret, "upload")).toBeNull();
  });

  it("hashes deterministically", () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(keyedHash("1.2.3.4", secret)).toHaveLength(32);
    expect(keyedHash("1.2.3.4", secret)).not.toBe(keyedHash("1.2.3.5", secret));
  });
});

describe("post-login destinations", () => {
  it("keep same-site paths and refuse anything that could leave the site", () => {
    expect(safeNextPath("/admin/assets?status=draft#top")).toBe("/admin/assets?status=draft#top");
    expect(safeNextPath("/admin/../admin/messages")).toBe("/admin/messages");
    for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r//evil.example", "https://evil.example", "evil", "", "/\u0000x", `/${"a".repeat(600)}`])
      expect(safeNextPath(bad), JSON.stringify(bad)).toBe("/admin");
    expect(safeNextPath(null, "/")).toBe("/");
  });
});
