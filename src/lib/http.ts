import { ZodError } from "zod";
import { env } from "@/lib/env";
import { keyedHash } from "@/lib/auth/tokens";

/** An error whose message is safe to show to the client. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const unauthorized = () => new HttpError(401, "Sign in to continue.", "unauthorized");
export const forbidden = (msg = "You don't have permission to do that.") => new HttpError(403, msg, "forbidden");
export const notFound = (msg = "Not found.") => new HttpError(404, msg, "not_found");
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, msg, "bad_request", details);

export function jsonError(err: unknown): Response {
  if (err instanceof HttpError) {
    return Response.json({ error: { code: err.code, message: err.message, details: err.details } }, { status: err.status });
  }
  if (err instanceof ZodError) {
    return Response.json(
      { error: { code: "invalid_input", message: "Some fields are invalid.", details: err.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } },
      { status: 400 },
    );
  }
  // A publishing rule in the database refused the change; the trigger's message is written for people.
  if ((err as { code?: string } | null)?.code === "23514" && /^(Shader|Starter project|Creator|Tutorial|Resource|Asset) /.test((err as Error).message)) {
    return Response.json({ error: { code: "not_ready", message: (err as Error).message + "." } }, { status: 400 });
  }
  // Row-level security refused the write: the role isn't allowed to do this.
  if ((err as { code?: string } | null)?.code === "42501" || /row-level security/i.test((err as Error | null)?.message ?? "")) {
    return Response.json({ error: { code: "forbidden", message: "Your role can't make this change. Ask an admin." } }, { status: 403 });
  }
  console.error(err);
  return Response.json({ error: { code: "internal", message: "Something went wrong on the server." } }, { status: 500 });
}

type Handler<C> = (request: Request, context: C) => Promise<Response>;

/** Wraps a route handler with uniform error responses. */
export function route<C>(fn: Handler<C>): Handler<C> {
  return async (request, context) => {
    try {
      return await fn(request, context);
    } catch (err) {
      return jsonError(err);
    }
  };
}

/**
 * CSRF defence for cookie-authenticated mutations: the Origin (or Referer)
 * must be this site. SameSite=Lax cookies already block most cross-site
 * requests; this closes the remaining gaps.
 */
export function assertSameOrigin(request: Request): void {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const url = new URL(request.url);
  const allowed = new Set([new URL(env().NEXT_PUBLIC_APP_URL).origin, url.origin]);
  // The Host the browser actually sent (request.url can be normalised, e.g. to localhost in dev).
  // A cross-site request carries our Host but the other site's Origin, so it still fails.
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (host) allowed.add(`${request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")}://${host}`);
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const source = origin ?? (referer ? new URL(referer).origin : null);
  if (!source || !allowed.has(source)) throw forbidden("Request blocked: it did not come from this site.");
}

/** Hashed client address for rate limiting; raw IPs are never stored. */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  return keyedHash(ip, env().APP_SECRET);
}

export async function readJson<T>(request: Request, maxBytes = 256 * 1024): Promise<T> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > maxBytes) throw new HttpError(413, "Request body is too large.", "too_large");
  const text = await request.text();
  if (text.length > maxBytes) throw new HttpError(413, "Request body is too large.", "too_large");
  try {
    return JSON.parse(text) as T;
  } catch {
    throw badRequest("Request body must be JSON.");
  }
}
