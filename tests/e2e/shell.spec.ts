import { expect, test } from "@playwright/test";

test.describe("public shell", () => {
  test("home renders hero, search and texture page", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/LOWPO11Y/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("low-poly");
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByRole("img", { name: /Red brick wall texture/ })).toBeVisible();
  });

  test("primary navigation reaches every section", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const [label, path, heading] of [
      ["Assets", "/assets", "Assets"],
      ["Textures", "/textures", "Textures"],
      ["Shaders & Code", "/shaders", "Shaders & Code"],
      ["Learn", "/learn", "Learn"],
      ["Resources", "/resources", "Resources"],
      ["Scene Builder", "/scene-builder", "Scene Builder"],
    ] as const) {
      await nav.getByRole("link", { name: label, exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${path}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
      await expect(nav.getByRole("link", { name: label, exact: true })).toHaveAttribute("data-active", "true");
    }
  });

  test("tools mega menu opens and links to the tools index", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Tools" }).click();
    await page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "All tools" }).click();
    await expect(page).toHaveURL(/\/tools$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tools");
  });

  test("search palette opens with the keyboard and navigates", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const box = page.getByRole("combobox", { name: "Search" });
    await expect(box).toBeFocused();
    await box.fill("licen");
    await expect(page.getByRole("option", { name: /Licences/ })).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/licences$/);
  });

  test("search palette shows a helpful empty state", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /Search/ }).first().click();
    await page.getByRole("combobox", { name: "Search" }).fill("zzqx");
    await expect(page.getByText(/No matches for/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("combobox", { name: "Search" })).toBeHidden();
  });

  test("CRT effects toggle switches and persists", async ({ page }) => {
    await page.goto("/");
    const toggle = page.getByRole("switch", { name: /CRT/ });
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await toggle.click();
    await expect(page.locator("html")).toHaveAttribute("data-crt", "off");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-crt", "off");
    await page.getByRole("switch", { name: /CRT/ }).click();
    await expect(page.locator("html")).not.toHaveAttribute("data-crt", "off");
  });

  test("skip link moves focus to main content", async ({ page }) => {
    await page.goto("/about");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("unknown pages return 404 with recovery links", async ({ page }) => {
    const res = await page.goto("/definitely-not-here");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("isn’t in the library");
    await expect(page.getByRole("main").getByRole("link", { name: "Browse assets" })).toBeVisible();
  });

  test("robots and sitemap are served", async ({ request }) => {
    const robots = await request.get("/robots.txt");
    expect(await robots.text()).toContain("Disallow: /admin");
    const sitemap = await request.get("/sitemap.xml");
    expect(await sitemap.text()).toContain("/licences");
  });
});

test.describe("mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("menu drawer opens, navigates and closes", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Open menu" }).click();
    const drawer = page.getByRole("dialog");
    await expect(drawer).toBeVisible();
    await drawer.getByRole("link", { name: /Textures/ }).click();
    await expect(page).toHaveURL(/\/textures$/);
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("page has no horizontal overflow", async ({ page }) => {
    for (const path of ["/", "/tools", "/licences"]) {
      await page.goto(path);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });
});
