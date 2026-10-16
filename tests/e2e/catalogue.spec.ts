import { unzipSync } from "fflate";
import { expect, test } from "@playwright/test";

/** Journey 1: a visitor finds, inspects and downloads an asset. */
test.describe("catalogue", () => {
  test("search with a typo, filter, open a model and download its ZIP", async ({ page, request }) => {
    await page.goto("/assets");
    await expect(page.getByRole("heading", { level: 1, name: "Assets" })).toBeVisible();
    await expect(page.getByText(/21 assets/i)).toBeVisible();

    await page.getByRole("searchbox", { name: /search assets/i }).fill("wooden crat");
    await page.getByRole("search").getByRole("button", { name: /search/i }).click();
    await expect(page).toHaveURL(/q=wooden\+crat/);
    await expect(page.getByRole("link", { name: /Wooden crate/ }).first()).toBeVisible();

    // A facet toggles on, shows as a removable chip, and clears.
    await page.goto("/assets?type=model");
    await expect(page.getByRole("link", { name: "Remove filter: Model" })).toBeVisible();
    await expect(page.getByText(/10 assets/i)).toBeVisible();
    await page.getByRole("link", { name: "Remove filter: Model" }).click();
    await expect(page).toHaveURL(/\/assets$/);

    await page.goto("/assets/demo-wooden-crate");
    await expect(page.getByRole("heading", { level: 1, name: "Wooden crate" })).toBeVisible();
    await expect(page.getByText("60 tris //", { exact: false }).first()).toBeVisible();
    // The 3D viewer loads the GLB, or reports WebGL is unavailable; it never hangs on "loading".
    await expect(page.getByRole("button", { name: "Wire" }).or(page.getByText(/couldn't start WebGL|couldn't be loaded/))).toBeEnabled({ timeout: 15_000 });

    const zipLink = page.getByRole("link", { name: /Download ZIP/ });
    const href = await zipLink.getAttribute("href");
    expect(href).toMatch(/^\/api\/download\/[0-9a-f-]{36}$/);
    const res = await request.get(`${href}?e=e2e-${Date.now()}`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const zip = await request.get(res.headers()["location"]!);
    expect(zip.ok()).toBe(true);
    const entries = Object.keys(unzipSync(new Uint8Array(await zip.body())));
    expect(entries).toEqual(expect.arrayContaining(["demo-wooden-crate/LICENSE.txt", "demo-wooden-crate/README.txt", "demo-wooden-crate/manifest.json"]));
  });

  test("textures preview at native resolution and tile", async ({ page }) => {
    await page.goto("/textures/demo-red-brick");
    const preview = page.getByRole("img", { name: /Red brick wall, 128×128 pixels/ });
    await expect(preview).toBeVisible();
    await page.getByRole("button", { name: "3×3" }).click();
    await page.getByRole("button", { name: "4×" }).click();
    await expect(page.getByRole("img", { name: /tiled 3×3 at 4× zoom/ })).toBeVisible();
    await expect(page.getByText("demo-red-brick_64.png")).toBeVisible();
  });

  test("wrong section redirects and missing assets are real 404s", async ({ request }) => {
    const moved = await request.get("/textures/demo-wooden-crate", { maxRedirects: 0 });
    expect(moved.status()).toBe(308);
    expect(moved.headers()["location"]).toMatch(/\/assets\/demo-wooden-crate$/);
    expect((await request.get("/assets/no-such-asset")).status()).toBe(404);
    expect((await request.get("/collections/no-such-pack")).status()).toBe(404);
  });

  test("collections list packs and download a counted pack ZIP", async ({ page, request }) => {
    await page.goto("/collections");
    await page.getByRole("link", { name: /Demo: industrial blockout kit/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Demo: industrial blockout kit" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "// In this pack" })).toBeVisible();
    const res = await request.get("/api/collections/demo-industrial-blockout-kit/download", { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    const zip = await request.get(res.headers()["location"]!);
    expect(Object.keys(unzipSync(new Uint8Array(await zip.body())))).toContain("demo-industrial-blockout-kit/NOTICE.txt");
  });

  test("the command palette finds catalogue items", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /search/i }).first().click();
    await page.getByRole("combobox", { name: "Search" }).fill("oil drum");
    await expect(page.getByRole("option", { name: /Rusted oil drum/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/assets\/demo-oil-drum$/);
  });

  test("the sitemap lists published assets and collections", async ({ request }) => {
    const xml = await (await request.get("/sitemap.xml")).text();
    expect(xml).toContain("/assets/demo-wooden-crate");
    expect(xml).toContain("/textures/demo-red-brick");
    expect(xml).toContain("/collections/demo-texture-page-0");
  });
});
