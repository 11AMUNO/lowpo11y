import sharp from "sharp";
import { unzipSync } from "fflate";
import { expect, test, type Page } from "@playwright/test";
import { asAdmin } from "./fixtures";

/** A small seamless test texture made on the fly, so no binary fixture is committed. */
async function testPng(size = 64): Promise<Buffer> {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      px[i] = on ? 196 : 92;
      px[i + 1] = on ? 150 : 70;
      px[i + 2] = on ? 60 : 30;
      px[i + 3] = 255;
    }
  return sharp(px, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

/** Journey 2: staff create, upload, license and publish an asset; visitors download it; unpublishing takes it down. */
test.describe("admin asset CMS", () => {
  test("create → upload → licence → publish → download → unpublish", async ({ page, request }) => {
    await asAdmin(page, "/admin/assets/new");
    await page.getByLabel("Title").fill("E2E brass checker");
    await page.getByLabel("Type").selectOption("texture");
    await page.getByRole("button", { name: "Create draft" }).click();
    await page.waitForURL(/\/admin\/assets\/[0-9a-f-]{36}$/);
    const editorUrl = page.url();

    // Nothing to publish yet: required items are flagged and the button is disabled.
    const checklist = page.getByRole("list", { name: "Publishing checklist" });
    await expect(checklist.getByText("A known licence is chosen — required")).toBeAttached();
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();

    // Signed upload straight to storage, then server-side verification and previews.
    await page.locator('input[type="file"]').setInputFiles({ name: "e2e-brass.png", mimeType: "image/png", buffer: await testPng() });
    await expect(page.getByRole("list", { name: "Upload queue" }).getByText("Done")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("status").filter({ hasText: /Generated .*e2e-brass-thumb\.webp/ })).toBeVisible({ timeout: 20_000 });
    await page.reload();
    await expect(page.getByRole("link", { name: "e2e-brass.png" })).toBeVisible();
    await expect(page.getByRole("link", { name: "e2e-brass-thumb.webp" })).toBeVisible();
    await expect(page.getByRole("link", { name: "e2e-brass_32.png" })).toBeVisible();

    // A file upload whose bytes don't match its extension is rejected by content.
    await page.locator('input[type="file"]').setInputFiles({ name: "not-really.png", mimeType: "image/png", buffer: Buffer.from("this is text, not a PNG") });
    await expect(page.getByRole("list", { name: "Upload queue" }).getByText(/^! /)).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("Short description").fill("Two-tone brass checker for testing the publishing flow.");
    await page.getByLabel("Category").selectOption({ label: "Metal" });
    await page.getByLabel("Tags").fill("brass, checker, industrial");
    await page.getByRole("button", { name: "Save details" }).click();
    await expectToast(page, "Details saved");

    await page.getByLabel("Licence", { exact: true }).selectOption({ label: "Creative Commons Zero 1.0 Universal (CC0)" });
    await page.getByRole("checkbox", { name: /I confirm we own this asset/ }).check();
    await page.getByRole("button", { name: "Save licence" }).click();
    await expectToast(page, "Licence saved and rights confirmed");

    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectToast(page, "Published");
    const publicLink = page.getByRole("link", { name: "View public page" });
    await expect(publicLink).toBeVisible();
    const publicPath = (await publicLink.getAttribute("href"))!;
    expect(publicPath).toBe("/textures/e2e-brass-checker");

    // Visitors see it in the catalogue and can download the bundle.
    const anon = await page.context().browser()!.newContext();
    const visitor = await anon.newPage();
    await visitor.goto("/textures?q=brass");
    await visitor.getByRole("link", { name: /E2E brass checker/ }).first().click();
    await expect(visitor.getByRole("heading", { level: 1, name: "E2E brass checker" })).toBeVisible();
    const href = await visitor.getByRole("link", { name: /Download ZIP/ }).getAttribute("href");
    const redirect = await request.get(href!, { maxRedirects: 0 });
    const zip = unzipSync(new Uint8Array(await (await request.get(redirect.headers()["location"]!)).body()));
    expect(Object.keys(zip)).toEqual(expect.arrayContaining(["e2e-brass-checker/files/e2e-brass.png", "e2e-brass-checker/LICENSE.txt"]));
    expect(new TextDecoder().decode(zip["e2e-brass-checker/LICENSE.txt"])).toContain("Creative Commons Zero");

    // Unpublishing takes it down immediately.
    await page.goto(editorUrl);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Unpublish" }).click();
    await expectToast(page, "Unpublished");
    expect((await request.get(publicPath)).status()).toBe(404);
    expect((await request.get(redirect.headers()["location"]!)).status()).toBe(404);
    await anon.close();

    // History records each step.
    await page.reload();
    const history = page.getByRole("complementary", { name: "Publishing" });
    for (const label of ["Created", "Added a file", "Confirmed rights", "Published", "Unpublished"]) {
      await expect(history.getByText(label, { exact: true }).first()).toBeVisible();
    }
  });

  test("collections: build a pack from published assets", async ({ page }) => {
    await asAdmin(page, "/admin/collections/new");
    await page.getByLabel("Title").fill("E2E crate pack");
    await page.getByRole("button", { name: "Create collection" }).click();
    await page.waitForURL(/\/admin\/collections\/[0-9a-f-]{36}$/);
    await page.getByLabel("Add assets").fill("crate");
    await page.getByRole("list", { name: "Matching assets" }).getByRole("button", { name: "Add" }).first().click();
    await page.getByLabel("Add assets").fill("pallet");
    await page.getByRole("list", { name: "Matching assets" }).getByRole("button", { name: "Add" }).first().click();
    await expect(page.getByText("Unsaved changes to the asset list.")).toBeVisible();
    await page.getByRole("button", { name: "Save collection" }).click();
    await expectToast(page, "Collection saved");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectToast(page, "Collection published");
    await page.goto("/collections/e2e-crate-pack");
    await expect(page.getByRole("heading", { level: 1, name: "E2E crate pack" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Wooden crate/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Wooden pallet/ })).toBeVisible();
  });

  test("bulk import: plan, import drafts, then detect them as already imported", async ({ page }) => {
    await asAdmin(page, "/admin/import");
    const files = [
      { name: "01 - E2E Teak Planks.png", mimeType: "image/png", buffer: await testPng(32) },
      { name: "02 - E2E Ash Boards.png", mimeType: "image/png", buffer: await testPng(48) },
    ];
    await page.getByLabel("Files to import").setInputFiles(files);
    await expect(page.getByText("2 files //")).toBeVisible();
    await page.getByLabel("Category").selectOption({ label: "Wood" });
    await page.getByRole("button", { name: "Plan import" }).click();
    await expect(page.getByText("2 ready // 0 already imported // 0 blocked")).toBeVisible();
    await expect(page.getByRole("cell", { name: /^E2E Teak Planks Texture/ })).toBeVisible();
    await page.getByRole("button", { name: "Import 2 drafts" }).click();
    await expect(page.getByRole("link", { name: "Created draft" })).toHaveCount(2, { timeout: 30_000 });
    await expect(page.getByRole("link", { name: "Review drafts" })).toBeVisible();

    // The same files again are recognised by checksum.
    await page.getByRole("button", { name: "Plan import" }).click();
    await expect(page.getByText("0 ready // 2 already imported // 0 blocked")).toBeVisible();

    await page.goto("/admin/assets?status=draft&q=E2E+Teak");
    await page.getByRole("link", { name: "E2E Teak Planks" }).click();
    await expect(page.getByRole("link", { name: "01 - E2E Teak Planks.png" })).toBeVisible();
    await expect(page.getByRole("link", { name: /thumb\.webp$/ })).toBeVisible();
    // Imports never confirm rights or pick a licence on their own.
    await expect(page.getByRole("list", { name: "Publishing checklist" }).getByText("A known licence is chosen — required")).toBeAttached();
  });

  test("contact form message reaches the admin inbox", async ({ page }) => {
    await page.goto("/contact?topic=takedown&asset=demo-wooden-crate");
    await expect(page.getByLabel("What is it about?")).toHaveValue("takedown");
    await expect(page.getByLabel("Page on this site (optional)")).toHaveValue("/assets/demo-wooden-crate");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Tell us your name.")).toBeVisible();
    await page.getByLabel("Your name").fill("Rights Holder");
    await page.getByLabel("Email").fill("holder@example.test");
    await page.getByLabel("Subject").fill("E2E takedown request");
    await page.getByLabel("Message").fill("This crate is mine; here is the original project file link.");
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Message sent")).toBeVisible();

    await asAdmin(page);
    await expect(page.getByText(/open takedown request/)).toBeVisible();
    await page.goto("/admin/messages");
    const card = page.getByRole("article").filter({ hasText: "E2E takedown request" });
    await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Resolved" }).click();
    await expectToast(page, "Marked resolved");
  });
});
