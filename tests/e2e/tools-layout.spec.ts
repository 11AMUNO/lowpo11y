import { expect, test, type Page } from "@playwright/test";

const TOOLS = ["/tools/seamless", "/tools/texture-converter", "/tools/resizer", "/tools/palette", "/tools/texture-atlas"];

/** Top and bottom of each column of the tool's workspace grid, in page order. */
const columns = (page: Page) =>
  page.locator("main .grid").first().evaluate((grid) => [...grid.children].map((c) => ({ top: c.getBoundingClientRect().top, bottom: c.getBoundingClientRect().bottom, scroll: c.scrollHeight, height: c.clientHeight })));

for (const path of TOOLS) {
  test(`${path}: phone layout stacks panels without overlap`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.getByRole("button", { name: "+ Sample" }).first().click(); // would be covered if panels overlapped
    await expect(page.getByRole("status").first()).not.toContainText("IDLE", { timeout: 20_000 });
    const cols = await columns(page);
    for (let i = 1; i < cols.length; i++) expect(cols[i]!.top).toBeGreaterThanOrEqual(cols[i - 1]!.bottom - 1);
  });

  test(`${path}: desktop workspace fills the window and the page itself never scrolls`, async ({ page }) => {
    await page.goto(path);
    await page.getByRole("button", { name: "+ Sample" }).first().click();
    await expect(page.getByRole("status").first()).not.toContainText("IDLE", { timeout: 20_000 });
    const [scrollH, innerH] = await page.evaluate(() => [document.documentElement.scrollHeight, window.innerHeight]);
    expect(scrollH).toBe(innerH);
    const cols = await columns(page);
    expect(Math.round(Math.max(...cols.map((c) => c.bottom)))).toBeLessThanOrEqual(innerH);
  });
}
