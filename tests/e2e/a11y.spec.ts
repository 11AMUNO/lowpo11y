import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = [
  "/",
  "/tools",
  "/assets",
  "/assets?view=list&type=model",
  "/textures",
  "/assets/demo-wooden-crate",
  "/textures/demo-red-brick",
  "/collections",
  "/collections/demo-industrial-blockout-kit",
  "/assets/no-such-asset",
  "/about",
  "/licences",
  "/privacy",
  "/contact",
];

for (const crt of ["on", "off"] as const) {
  test.describe(`accessibility (CRT ${crt})`, () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((v) => localStorage.setItem("lp-crt", v), crt);
    });
    for (const path of PAGES) {
      test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
        await page.goto(path);
        // aria-hidden marks are decorative by contract (see docs/DESIGN_SYSTEM.md) and may use the dim tone.
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
          .exclude('[aria-hidden="true"]')
          .analyze();
        const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
        expect(summary).toEqual([]);
      });
    }
  });
}
