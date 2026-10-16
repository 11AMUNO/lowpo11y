/**
 * Dev helper: screenshot pages of a running server for design review.
 *   tsx scripts/dev/screenshot.ts <baseUrl> <outDir> <path[@WIDTH][#light]> ...
 * Example: tsx scripts/dev/screenshot.ts http://127.0.0.1:3200 /tmp/shots / /tools@390 /about#light
 * Append actions with "!": "/!hover=text=Tools", "/!key=Control+k", "/!click=button[aria-label='Open menu']",
 * "/!type=crate". Actions run in order before the screenshot (viewport only when actions are present).
 */
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";

async function main() {
  const [base, outDir, ...targets] = process.argv.slice(2);
  if (!base || !outDir) throw new Error("usage: screenshot <baseUrl> <outDir> <paths...>");
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  for (const target of targets) {
    const [spec = "/", ...actions] = target.split("!");
    const light = spec.includes("#light");
    const [p = "/", w] = spec.replace("#light", "").split("@");
    const width = Number(w ?? 1440);
    const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
    if (light) await page.addInitScript(() => localStorage.setItem("lp-theme", "light"));
    await page.goto(new URL(p, base).toString(), { waitUntil: "load" });
    await page.waitForTimeout(400);
    for (const action of actions) {
      const [kind, ...rest] = action.split("=");
      const arg = rest.join("=");
      if (kind === "hover") await page.locator(arg).first().hover();
      else if (kind === "click") await page.locator(arg).first().click();
      else if (kind === "key") await page.keyboard.press(arg);
      else if (kind === "type") await page.keyboard.type(arg);
      await page.waitForTimeout(350);
    }
    const suffix = actions.length ? `_${actions.join("_").replace(/\W+/g, "")}`.slice(0, 40) : "";
    const name = `${p.replace(/\W+/g, "_") || "home"}_${width}${light ? "_light" : ""}${suffix}.png`;
    await page.screenshot({ path: path.join(outDir, name), fullPage: actions.length === 0 });
    console.log(name);
    await page.close();
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
