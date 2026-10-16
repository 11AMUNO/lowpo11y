import { describe, expect, it } from "vitest";
import { absoluteUrl, site } from "./site";

describe("absoluteUrl", () => {
  it("resolves paths against the site URL", () => {
    expect(absoluteUrl("/assets/crate")).toBe(new URL("/assets/crate", site.url).toString());
  });
  it("defaults to the root", () => {
    expect(absoluteUrl()).toBe(new URL("/", site.url).toString());
  });
});
