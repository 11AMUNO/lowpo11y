import { expect, test, type Page } from "@playwright/test";
import { asAdmin } from "./fixtures";

/**
 * Anonymous usage counting: pages, searches, downloads and tool exports
 * reach the admin's Usage page as counts; a browser that asks not to be
 * tracked sends nothing; the endpoint takes only its closed vocabulary.
 */

// Headless browsers are filtered out as bots, so these tests present an ordinary desktop browser.
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function totals(page: Page) {
  await asAdmin(page, "/admin/usage?days=7");
  const text = await page.locator("main").innerText();
  const n = (label: string) => Number(new RegExp(`${label}\\s+([\\d,]+)`, "i").exec(text)?.[1]?.replace(/,/g, "") ?? "0");
  return { views: n("Page views"), searches: n("Searches"), afterSearch: n("Downloads after a search") };
}

test.describe("usage counts", () => {
  test.use({ userAgent: DESKTOP });

  test("a visit, a search, a download and a tool export are counted, without identifiers", async ({ page, browser }) => {
    const before = await totals(page);
    const visitor = await browser.newContext({ userAgent: DESKTOP });
    // Beacon bodies aren't visible to Playwright, so the page keeps a copy of each one it sends.
    await visitor.addInitScript(() => {
      const w = window as unknown as { __sent: string[] };
      w.__sent = JSON.parse(sessionStorage.getItem("__sent") ?? "[]");
      const send = navigator.sendBeacon.bind(navigator);
      navigator.sendBeacon = (url, data) => {
        void (data as Blob).text().then((t) => {
          w.__sent.push(t);
          sessionStorage.setItem("__sent", JSON.stringify(w.__sent));
        });
        return send(url, data);
      };
    });
    const v = await visitor.newPage();
    let sent: string[] = [];
    const refresh = async () => (sent = await v.evaluate(() => (window as unknown as { __sent: string[] }).__sent));
    await v.goto("/assets?q=crate");
    await v.getByRole("link", { name: "Wooden crate" }).first().click();
    await v.waitForURL(/\/assets\/demo-wooden-crate$/);
    const dl = v.waitForEvent("download");
    await v.getByRole("link", { name: /Download ZIP/ }).first().click();
    await dl;
    await v.goto("/tools/palette");
    await v.getByRole("button", { name: "+ Sample" }).first().click();
    await v.getByRole("button", { name: /^Extract \d+ colours$/ }).click();
    const saved = v.waitForEvent("download");
    await v.getByRole("button", { name: ".GPL", exact: true }).click();
    await saved;
    await expect.poll(async () => (await refresh()).some((b) => b.includes('"e":"page_view"') && b.includes("tool-palette"))).toBe(true);
    expect(sent.some((b) => b.includes('"e":"download"') && b.includes('"s":"search"'))).toBe(true);
    expect(sent.some((b) => b.includes('"e":"search"') && b.includes('"s":"assets"'))).toBe(true);
    await expect.poll(async () => (await refresh()).some((b) => b.includes('"e":"export"') && b.includes("tool-palette:gpl"))).toBe(true);
    // Payloads are a name and a section, nothing else.
    for (const b of sent) expect(Object.keys(JSON.parse(b)).every((k) => ["e", "s", "v", "g"].includes(k))).toBe(true);
    expect(sent.join()).not.toContain("crate"); // the search words never leave the page
    await visitor.close();

    await expect.poll(async () => (await totals(page)).views, { timeout: 15_000 }).toBeGreaterThan(before.views);
    const after = await totals(page);
    expect(after.searches).toBeGreaterThan(before.searches);
    expect(after.afterSearch).toBeGreaterThan(before.afterSearch);
  });

  test("Do Not Track and Global Privacy Control turn counting off", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: DESKTOP, extraHTTPHeaders: { DNT: "1" } });
    await ctx.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { value: true }));
    const p = await ctx.newPage();
    let sent = 0;
    p.on("request", (r) => {
      if (r.url().endsWith("/api/events")) sent++;
    });
    await p.goto("/");
    await p.goto("/textures");
    await p.waitForTimeout(1500);
    expect(sent).toBe(0);
    await ctx.close();
  });

  test("the endpoint accepts only its vocabulary, from this site", async ({ request, baseURL }) => {
    const origin = new URL(baseURL!).origin;
    const post = (data: unknown, headers: Record<string, string> = { Origin: origin }) => request.post("/api/events", { data, headers: { "User-Agent": DESKTOP, ...headers } });
    expect((await post({ e: "page_view", s: "home" })).status()).toBe(204);
    expect((await post({ e: "page_view", s: "home" }, { Origin: "https://evil.example" })).status()).toBe(403);
    // Unknown events and free text are dropped quietly (still 204, nothing stored).
    expect((await post({ e: "keystrokes", s: "x" })).status()).toBe(204);
    expect((await post({ e: "search", s: "My Secret Query" })).status()).toBe(204);
  });
});
