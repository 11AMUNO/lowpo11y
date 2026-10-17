/**
 * Response security headers, computed when `next build` writes the routes
 * manifest (so changing a storage URL needs a redeploy, as with any
 * NEXT_PUBLIC_ variable). The Content Security Policy is static rather than
 * nonce-based: nonces would force every page, including the prerendered
 * tools, into per-request rendering (see ADR 0012). It still pins scripts,
 * workers, frames, connections and form targets to this site, the public
 * file bucket, the R2 upload endpoint and the YouTube privacy-enhanced embed.
 */
export interface HeaderEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_APP_URL?: string;
  STORAGE_PROVIDER?: string;
  R2_PUBLIC_BASE_URL?: string;
  R2_ACCOUNT_ID?: string;
  R2_ENDPOINT?: string;
}

const origin = (url: string | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export function contentSecurityPolicy(env: HeaderEnv): string {
  const dev = env.NODE_ENV === "development";
  const files = env.STORAGE_PROVIDER === "r2" ? origin(env.R2_PUBLIC_BASE_URL) : null;
  // Admin uploads go straight to the private bucket with a presigned PUT.
  const uploads = env.STORAGE_PROVIDER === "r2" ? (origin(env.R2_ENDPOINT) ?? (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null)) : null;
  const list = (...xs: (string | null | false)[]) => xs.filter(Boolean).join(" ");
  const https = origin(env.NEXT_PUBLIC_APP_URL)?.startsWith("https:") ?? false;
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    // Next.js inlines its flight data as scripts; React needs eval only in development.
    ["script-src", list("'self'", "'unsafe-inline'", dev && "'unsafe-eval'")],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", list("'self'", "data:", "blob:", files)],
    ["font-src", "'self' data:"],
    ["connect-src", list("'self'", "blob:", "data:", files, uploads, dev && "ws:")],
    ["media-src", list("'self'", "blob:", files)],
    ["worker-src", "'self' blob:"],
    ["frame-src", "https://www.youtube-nocookie.com"],
    ["manifest-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];
  return directives.map(([k, v]) => `${k} ${v}`).join("; ") + (https ? "; upgrade-insecure-requests" : "");
}

export function securityHeaders(env: HeaderEnv): { key: string; value: string }[] {
  const https = origin(env.NEXT_PUBLIC_APP_URL)?.startsWith("https:") ?? false;
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(env) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ...(https ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }] : []),
  ];
}
