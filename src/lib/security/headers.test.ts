import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./headers";

const directive = (csp: string, name: string) => csp.split("; ").find((d) => d.startsWith(`${name} `));

describe("security headers", () => {
  it("pin scripts, frames and forms to the site; no eval in production", () => {
    const csp = contentSecurityPolicy({ NODE_ENV: "production", NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3100" });
    expect(directive(csp, "script-src")).toBe("script-src 'self' 'unsafe-inline'");
    expect(directive(csp, "object-src")).toBe("object-src 'none'");
    expect(directive(csp, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(csp, "frame-src")).toBe("frame-src https://www.youtube-nocookie.com");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' blob: data:");
    expect(csp).not.toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy({ NODE_ENV: "development" })).toContain("'unsafe-eval'");
  });

  it("allow the public bucket and the R2 upload endpoint when files live in R2", () => {
    const csp = contentSecurityPolicy({ NODE_ENV: "production", STORAGE_PROVIDER: "r2", R2_PUBLIC_BASE_URL: "https://files.example.com/some/prefix", R2_ACCOUNT_ID: "abc123", NEXT_PUBLIC_APP_URL: "https://example.com" });
    expect(directive(csp, "img-src")).toBe("img-src 'self' data: blob: https://files.example.com");
    expect(directive(csp, "connect-src")).toBe("connect-src 'self' blob: data: https://files.example.com https://abc123.r2.cloudflarestorage.com");
    expect(csp.endsWith("; upgrade-insecure-requests")).toBe(true);
    expect(contentSecurityPolicy({ STORAGE_PROVIDER: "r2", R2_ENDPOINT: "http://localhost:9000" })).toContain("http://localhost:9000");
  });

  it("send HSTS only on https", () => {
    expect(securityHeaders({ NEXT_PUBLIC_APP_URL: "https://example.com" }).map((h) => h.key)).toContain("Strict-Transport-Security");
    expect(securityHeaders({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).map((h) => h.key)).not.toContain("Strict-Transport-Security");
  });
});
