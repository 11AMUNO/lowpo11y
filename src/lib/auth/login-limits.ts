/**
 * Sign-in throttling that slows guessing without letting strangers lock the
 * owner out. Every attempt counts against the address; only failures count
 * against an email. When an email is being guessed from many addresses,
 * only the addresses that have already failed for it are stopped, so the
 * owner signing in from their own device still gets through. Run with the
 * service context; addresses and emails arrive hashed.
 */
import type { Queryable } from "@/lib/db";
import { hitRateLimit, peekRateLimit, type RateLimitResult } from "./rate-limit";

export const LOGIN_LIMITS = {
  /** Attempts per address. */
  address: { limit: 10, windowSeconds: 15 * 60 },
  /** Failures per address for one email. */
  pair: { limit: 5, windowSeconds: 15 * 60 },
  /** Failures for one email from anywhere; above this, addresses with any failures for it wait (see `pairUnderAttack`). */
  email: { limit: 100, windowSeconds: 60 * 60 },
  pairUnderAttack: 3,
};

const keys = (address: string, email: string) => ({ address: `login:ip:${address}`, pair: `login:fail:${email}:${address}`, email: `login:fail:${email}` });

/** Counts this attempt; returns the limit that stops it, or null to go ahead. */
export async function checkLogin(q: Queryable, address: string, email: string, now = new Date()): Promise<RateLimitResult | null> {
  const k = keys(address, email);
  const byAddress = await hitRateLimit(q, k.address, LOGIN_LIMITS.address.limit, LOGIN_LIMITS.address.windowSeconds, now);
  if (!byAddress.ok) return byAddress;
  const pairFails = await peekRateLimit(q, k.pair, LOGIN_LIMITS.pair.windowSeconds, now);
  const emailFails = await peekRateLimit(q, k.email, LOGIN_LIMITS.email.windowSeconds, now);
  const pairLimit = emailFails >= LOGIN_LIMITS.email.limit ? LOGIN_LIMITS.pairUnderAttack : LOGIN_LIMITS.pair.limit;
  if (pairFails >= pairLimit) {
    const w = LOGIN_LIMITS.pair.windowSeconds * 1000;
    return { ok: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((Math.floor(now.getTime() / w) * w + w - now.getTime()) / 1000)) };
  }
  return null;
}

export async function recordLoginFailure(q: Queryable, address: string, email: string, now = new Date()): Promise<void> {
  const k = keys(address, email);
  await hitRateLimit(q, k.pair, LOGIN_LIMITS.pair.limit, LOGIN_LIMITS.pair.windowSeconds, now);
  await hitRateLimit(q, k.email, LOGIN_LIMITS.email.limit, LOGIN_LIMITS.email.windowSeconds, now);
}
