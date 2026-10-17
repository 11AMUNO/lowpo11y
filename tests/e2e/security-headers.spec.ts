import { expect, test, type Page } from "@playwright/test";
import { asAdmin } from "./fixtures";

/**
 * The Content Security Policy is sent on every page and nothing the site
 * does trips it: the 3D viewer, WebGL shader previews, Web Workers, the
 * Workshop, the Scene Builder and the admin all run under it.
 */

/** Records CSP violations (the event fires for blocked loads, inline code and eval). */
async function watchViolations(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __csp: string[] };
    w.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => w.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`));
  });
  const console: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/i.test(m.text())) console.push(m.text());
  });
  return async () => [...(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)), ...console];
}

test.describe("security headers", () => {
  test("every response carries the policy and the hardening headers", async ({ request }) => {
    for (const path of ["/", "/assets/demo-wooden-crate", "/tools/seamless", "/scene-builder", "/api/health"]) {
      const res = await request.get(path);
      const h = res.headers();
      expect(h["content-security-policy"], path).toContain("default-src 'self'");
      expect(h["content-security-policy"]).toContain("object-src 'none'");
      expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
      expect(h["content-security-policy"]).not.toContain("unsafe-eval");
      expect(h["x-content-type-options"]).toBe("nosniff");
      expect(h["x-frame-options"]).toBe("DENY");
      expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
      expect(h["x-powered-by"]).toBeUndefined();
    }
  });

  test("the public site, tools, workers and 3D views run without a policy violation", async ({ page }) => {
    test.setTimeout(120_000);
    const violations = await watchViolations(page);

    await page.goto("/assets/demo-wooden-crate");
    await expect(page.getByRole("button", { name: "Wire" })).toBeEnabled({ timeout: 15_000 });
    await page.goto("/shaders/psx-material-threejs");
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "ready", { timeout: 20_000 });
    await page.goto("/tools/seamless");
    await page.getByRole("button", { name: "+ Sample" }).first().click();
    await expect(page.getByRole("status").first()).not.toContainText("IDLE", { timeout: 20_000 });
    await page.goto("/workshop");
    await page.getByRole("button", { name: "+ Sample" }).click();
    await expect(page.getByRole("list", { name: "Image list" }).getByRole("listitem")).toHaveCount(4, { timeout: 20_000 });
    await page.goto("/scene-builder");
    await expect(page.getByText("LOADING 3D VIEW…")).toHaveCount(0, { timeout: 30_000 });
    await page.getByRole("button", { name: "Add Wooden crate" }).click();
    await expect(page.getByLabel("Scene statistics")).toContainText("60", { timeout: 20_000 });
    await page.goto("/learn");
    await page.goto("/contact");
    expect(await violations()).toEqual([]);
    // The watcher itself works: an image from another origin is blocked and reported.
    await page.evaluate(() => document.body.append(Object.assign(new Image(), { src: "https://blocked.example/x.png" })));
    await expect.poll(async () => (await violations()).join()).toContain("img-src");
  });

  test("the admin runs without a policy violation", async ({ page }) => {
    const violations = await watchViolations(page);
    await asAdmin(page, "/admin");
    await page.goto("/admin/assets");
    await page.goto("/admin/shaders");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await violations()).toEqual([]);
  });
});
