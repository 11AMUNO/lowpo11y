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
  "/tools/texture-atlas",
  "/tools/model-inspector",
  "/tools/bitmap-font",
  "/tools/decal",
  "/workshop",
  "/assets",
  "/assets?view=list&type=model",
  "/textures",
  "/assets/demo-wooden-crate",
  "/textures/demo-red-brick",
  "/collections",
  "/collections/demo-industrial-blockout-kit",
  "/shaders",
  "/shaders/psx-material-threejs",
  "/starter-projects",
  "/learn",
  "/learn/creators",
  "/resources",
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

test("texture atlas builder with tiles loaded has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/texture-atlas");
  await page.getByRole("button", { name: "+ Sample" }).click();
  await expect(page.getByRole("region", { name: "Atlas", exact: true }).getByRole("status")).toContainText("TILES //", { timeout: 20_000 });
  await page.getByRole("button", { name: "Fill transparency" }).click();
  await page.getByRole("button", { name: "Resize all" }).click();
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("model inspector with an animated model loaded has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/model-inspector");
  await page.getByRole("button", { name: "+ Rigged pole" }).click();
  await expect(page.getByRole("region", { name: "Animations" })).toBeVisible({ timeout: 20_000 });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("bitmap font generator with a font loaded has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/bitmap-font");
  await page.getByRole("button", { name: "+ Sample font" }).click();
  await expect(page.getByRole("region", { name: "Preview" }).getByRole("status")).toContainText("GLYPHS", { timeout: 20_000 });
  await page.getByRole("button", { name: "Drop shadow" }).click();
  await page.getByText("Licence in the font").click();
  await page.getByRole("img", { name: /^Sample text drawn/ }).click({ position: { x: 20, y: 16 } });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test("decal maker with an image keyed has no WCAG A/AA violations", async ({ page }) => {
  await page.goto("/tools/decal");
  await page.getByRole("button", { name: "+ Green screen" }).click();
  await expect(page.getByRole("list", { name: "Key colours" })).toContainText("#", { timeout: 20_000 });
  await page.getByRole("button", { name: "Look", exact: true }).click();
  await page.getByRole("button", { name: "Erase", exact: true }).click();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
});

test.describe("accessibility (admin)", () => {
  const PAGES = ["/admin", "/admin/assets", "/admin/assets/new", "/admin/import", "/admin/collections", "/admin/messages", "/admin/audit", "editor"];
  PAGES.push("/admin/usage", "/admin/licences", "/admin/licences?deep=1");
  PAGES.push("/admin/shaders", "/admin/shaders/new", "/admin/starter-projects", "/admin/learn/videos", "/admin/learn/creators", "/admin/resources", "shader editor", "resource editor");
  for (const path of PAGES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      if (path === "editor") {
        await asAdmin(page, "/admin/assets?q=wooden+crate");
        await page.getByRole("link", { name: "Wooden crate" }).click();
        await page.waitForURL(/\/admin\/assets\/[0-9a-f-]{36}$/);
      } else if (path === "shader editor") {
        await asAdmin(page, "/admin/shaders?q=psx-material");
        await page.getByRole("link", { name: "PSX material for three.js" }).click();
        await page.getByRole("button", { name: "Compile and preview" }).click();
        await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "ready", { timeout: 20_000 });
      } else if (path === "resource editor") {
        await asAdmin(page, "/admin/resources?q=poly-haven");
        await page.getByRole("link", { name: "Poly Haven" }).click();
        await page.waitForURL(/\/admin\/resources\/[0-9a-f-]{36}$/);
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
