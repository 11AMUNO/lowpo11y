import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { asAdmin } from "./fixtures";

const PAGES = [
  "/",
  "/tools",
  "/tools/seamless",
  "/tools/texture-converter",
  "/tools/resizer",
  "/tools/palette",
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

test("seamless tool with files loaded has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/seamless");
  await page.getByRole("button", { name: "+ Sample" }).click();
  await expect(page.getByRole("status").filter({ hasText: /SEAM/ }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Enable psx effects" }).click();
  await page.getByText("Advanced").first().click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("texture converter with an image loaded has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/texture-converter");
  await page.getByRole("button", { name: "+ Sample" }).click();
  await expect(page.getByRole("region", { name: "Preview" }).getByRole("status")).toContainText("COLOURS", { timeout: 20_000 });
  for (const m of ["Adjust", "Alpha"]) await page.getByRole("button", { name: m, exact: true }).click();
  await page.getByText("Per-channel bits").click();
  await page.getByText("Import a palette").click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("batch resizer with files resized has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/resizer");
  await page.getByRole("button", { name: "+ Sample" }).click();
  await page.getByRole("button", { name: /^Resize \d+ files$/ }).click();
  await expect(page.getByRole("button", { name: "All resized" })).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "Scale", exact: true }).click();
  await page.getByRole("button", { name: "WEBP", exact: true }).click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("palette generator with a palette and image loaded has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/palette");
  await page.getByRole("button", { name: /^Rust belt/ }).click();
  await page.getByRole("button", { name: "+ Sample" }).click();
  await expect(page.getByRole("region", { name: "Preview" }).getByRole("status")).toContainText("MAPPED TO", { timeout: 20_000 });
  await page.getByRole("button", { name: "Deutan" }).click();
  await page.getByText("Paste colours").click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test.describe("accessibility (admin)", () => {
  for (const path of ["/admin", "/admin/assets", "/admin/assets/new", "/admin/import", "/admin/collections", "/admin/messages", "/admin/audit", "editor"]) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      if (path === "editor") {
        await asAdmin(page, "/admin/assets?q=wooden+crate");
        await page.getByRole("link", { name: "Wooden crate" }).click();
        await page.waitForURL(/\/admin\/assets\/[0-9a-f-]{36}$/);
      } else {
        await asAdmin(page, path);
      }
      const results = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .exclude('[aria-hidden="true"]')
        .analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
    });
  }
});
