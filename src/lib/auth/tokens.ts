import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Compact signed token: base64url(JSON payload) + "." + base64url(HMAC-SHA256).
 * Used for local-storage upload/download URLs, which play the role of R2
 * presigned URLs in development. Payloads carry their own `exp` (unix seconds).
 */
export function signToken(payload: Record<string, unknown> & { exp: number }, secret: string, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const mac = createHmac("sha256", secret).update(`${purpose}.${body}`).digest("base64url");
  return `${body}.${mac}`;
}

export function verifyToken<T extends { exp: number }>(token: string, secret: string, purpose: string, now = Date.now()): T | null {
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", secret).update(`${purpose}.${body}`).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof payload.exp !== "number" || payload.exp * 1000 < now) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Keyed hash for values we must compare but should not store raw (e.g. client IPs). */
export function keyedHash(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 32);
}
