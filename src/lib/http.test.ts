import { describe, expect, it } from "vitest";
import { assertSameOrigin, HttpError } from "./http";

const req = (headers: Record<string, string>, method = "POST", url = "http://localhost:3200/api/x") => new Request(url, { method, headers });

describe("assertSameOrigin", () => {
  it("allows the origin the browser used, even when request.url was normalised", () => {
    expect(() => assertSameOrigin(req({ origin: "http://127.0.0.1:3200", host: "127.0.0.1:3200" }))).not.toThrow();
  });

  it("allows proxied HTTPS origins via forwarded headers", () => {
    expect(() =>
      assertSameOrigin(req({ origin: "https://lowpo11y.example", "x-forwarded-host": "lowpo11y.example", "x-forwarded-proto": "https", host: "internal:3000" })),
    ).not.toThrow();
  });

  it("blocks cross-site requests that carry our Host", () => {
    expect(() => assertSameOrigin(req({ origin: "https://evil.example", host: "127.0.0.1:3200" }))).toThrow(HttpError);
  });

  it("blocks requests with no Origin or Referer, and ignores safe methods", () => {
    expect(() => assertSameOrigin(req({ host: "127.0.0.1:3200" }))).toThrow(/did not come from this site/);
    expect(() => assertSameOrigin(req({}, "GET"))).not.toThrow();
  });

  it("falls back to the Referer", () => {
    expect(() => assertSameOrigin(req({ referer: "http://127.0.0.1:3200/admin", host: "127.0.0.1:3200" }))).not.toThrow();
  });
});
