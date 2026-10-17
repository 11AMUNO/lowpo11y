import AxeBuilder from "@axe-core/playwright";
import { unzipSync, zipSync } from "fflate";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { asAdmin } from "./fixtures";

// Unique per run, so a retry (or a rerun against a dev database) doesn't collide with an earlier run's slugs.
const RUN = Date.now().toString(36);

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude('[aria-hidden="true"]').analyze();
  expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([]);
}

async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.getByRole("status").filter({ hasText: text }).first()).toBeVisible();
}

/** Distinct colours in the preview canvas (it keeps its drawing buffer for this). */
async function previewColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = document.querySelector<HTMLCanvasElement>("[data-preview-state] canvas")!;
    const c = document.createElement("canvas");
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(src, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set<number>();
    for (let i = 0; i < d.length; i += 4) seen.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return seen.size;
  });
}

async function download(request: APIRequestContext, href: string): Promise<Uint8Array> {
  const redirect = await request.get(href, { maxRedirects: 0 });
  expect(redirect.status()).toBe(302);
  return new Uint8Array(await (await request.get(redirect.headers()["location"]!)).body());
}

test.describe("shaders", () => {
  test("the PSX material compiles and renders live, and its download matches the page", async ({ page, request }) => {
    await page.goto("/shaders");
    await page.getByRole("link", { name: /PSX material for three\.js/ }).click();
    await expect(page.getByRole("heading", { level: 1, name: "PSX material for three.js" })).toBeVisible();
    await expect(page.getByText(/^Tested with three\.js r\d+ \(WebGLRenderer, WebGL 2\) on \d{4}-\d{2}-\d{2}/)).toBeVisible();

    // The entry's own GLSL compiles in the browser and draws the scene.
    await expect(page.locator("[data-preview-state]")).toHaveAttribute("data-preview-state", "ready", { timeout: 20_000 });
    await page.getByRole("button", { name: "Pause" }).click();
    const full = await previewColours(page);
    expect(full).toBeGreaterThan(64);
    // Four levels per channel can make at most 4³ colours: the quantiser really runs.
    await page.getByLabel("Colour levels").fill("4");
    await expect.poll(() => previewColours(page)).toBeLessThanOrEqual(64);
    // The comparison draws with three.js's own material instead.
    await page.getByRole("button", { name: "Compare: standard" }).click();
    await expect.poll(() => previewColours(page)).toBeGreaterThan(64);

    // Code view and download carry the same code.
    const code = page.getByRole("region", { name: "// psx-material-threejs.glsl" });
    await expect(code.getByText("gl_FragColor = vec4(color, 1.0);")).toBeVisible();
    const zip = unzipSync(await download(request, (await page.getByRole("link", { name: /Download ZIP/ }).getAttribute("href"))!));
    expect(Object.keys(zip).sort()).toEqual(["psx-material-threejs/LICENSE.txt", "psx-material-threejs/README.md", "psx-material-threejs/psx-material-threejs.glsl"]);
    const glsl = new TextDecoder().decode(zip["psx-material-threejs/psx-material-threejs.glsl"]);
    expect(glsl).toContain("// --- fragment ---");
    expect(new TextDecoder().decode(zip["psx-material-threejs/README.md"])).toContain("## Limitations");
    expect(new TextDecoder().decode(zip["psx-material-threejs/LICENSE.txt"])).toContain("Creative Commons Zero");

    // Search finds it too.
    const hits = (await (await request.get("/api/search?q=PSX material")).json()) as { results: { kind: string; href: string }[] };
    expect(hits.results).toContainEqual(expect.objectContaining({ kind: "shader", href: "/shaders/psx-material-threejs" }));
  });

  test("untested drafts stay off the site, and the admin preview reports compile errors", async ({ page, request }) => {
    expect((await request.get("/shaders/psx-surface-godot")).status()).toBe(404);
    await asAdmin(page, "/admin/shaders?status=draft");
    await page.getByRole("link", { name: "PSX surface for Godot 4" }).click();
    const checklist = page.getByRole("list", { name: "Publishing checklist" });
    await expect(checklist.getByText("Tested: date and what it was tested with — required")).toBeAttached();
    await expect(checklist.getByText("A known licence — required")).toBeAttached();
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();

    // A three.js shader that doesn't compile shows the compiler's message instead of a scene.
    await page.goto("/admin/shaders?status=published");
    await page.getByRole("link", { name: "PSX material for three.js" }).click();
    const codeBox = page.getByLabel("Code", { exact: true });
    await codeBox.fill((await codeBox.inputValue()).replace("gl_FragColor = vec4(color, 1.0);", "gl_FragColor = vec4(color, 1.0) + undefinedThing;"));
    await page.getByRole("button", { name: "Compile and preview" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "This shader didn't compile in your browser" })).toContainText("undefinedThing", { timeout: 20_000 });
    await expect(page.getByText("You have unsaved changes.")).toBeVisible();
  });
});

test.describe("starter projects", () => {
  test("upload a checked ZIP, publish, download the same bytes; unsafe archives are refused", async ({ page, request }) => {
    await asAdmin(page, "/admin/starter-projects/new");
    await page.getByLabel("Title").fill(`E2E fixed camera starter ${RUN}`);
    await page.getByLabel("Engine").selectOption("godot");
    await page.getByRole("button", { name: "Create starter project" }).click();
    await page.waitForURL(/\/admin\/starter-projects\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("list", { name: "Publishing checklist" }).getByText("A download file — required")).toBeAttached();

    const bad = zipSync({ "project.godot": new Uint8Array([1]), "tools/setup.sh": new TextEncoder().encode("rm -rf /\n") });
    await page.locator('input[type="file"]').setInputFiles({ name: "bad.zip", mimeType: "application/zip", buffer: Buffer.from(bad) });
    await expect(page.getByRole("alert").filter({ hasText: "Binaries and shell scripts aren't allowed" })).toBeVisible({ timeout: 20_000 });

    const good = zipSync({ "project.godot": new TextEncoder().encode("[application]\nconfig/name=\"E2E\"\n"), "scenes/main.tscn": new TextEncoder().encode("[gd_scene format=3]\n"), "scripts/camera.gd": new TextEncoder().encode("extends Camera3D\n") });
    await page.locator('input[type="file"]').setInputFiles({ name: "fixed-camera.zip", mimeType: "application/zip", buffer: Buffer.from(good) });
    await expectToast(page, "fixed-camera.zip checked and attached");
    await expect(page.getByText("fixed-camera.zip", { exact: true })).toBeVisible();

    await page.getByLabel("Engine versions").fill("4.3");
    await page.getByLabel("What's included").fill("Fixed camera zones\nDoor trigger");
    await page.getByLabel("Description").fill("Open the folder in Godot and press F5.");
    await page.getByLabel("Tested on").fill("2026-10-17");
    await page.getByLabel("Licence", { exact: true }).selectOption({ label: "MIT License" });
    await page.getByRole("button", { name: "Save starter project" }).click();
    await expectToast(page, "Saved");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectToast(page, "Published");

    await page.goto("/starter-projects");
    await page.getByRole("link", { name: new RegExp(`E2E fixed camera starter ${RUN}`) }).click();
    await page.waitForURL(new RegExp(`/starter-projects/e2e-fixed-camera-starter-${RUN}$`));
    await expect(page.getByText("> Fixed camera zones")).toBeVisible();
    await expectAccessible(page);
    const bytes = await download(request, (await page.getByRole("link", { name: /Download ZIP/ }).getAttribute("href"))!);
    expect(Buffer.from(bytes).equals(Buffer.from(good))).toBe(true);
  });
});

test.describe("Learn and resources", () => {
  test("approve a creator, publish their video, filter and play it; unapproving takes it down", async ({ page, request }) => {
    await asAdmin(page, "/admin/learn/creators/new");
    await page.getByLabel("Name").fill(`Example Low Poly Channel ${RUN}`);
    await page.getByRole("button", { name: "Create creator" }).click();
    await page.waitForURL(/\/admin\/learn\/creators\/[0-9a-f-]{36}$/);
    const creatorUrl = page.url();
    await page.getByLabel("Description").fill("Short lessons on modelling props in very few triangles.");
    await page.getByLabel("YouTube channel").fill("https://www.youtube.com/@example");
    await page.getByLabel("Last reviewed").fill("2026-10-17");
    await page.getByRole("checkbox", { name: "Low-Poly Modelling" }).check();
    await page.getByRole("button", { name: "Save creator" }).click();
    await expectToast(page, "Saved");
    await page.getByRole("button", { name: "Approve creator" }).click();
    await expectToast(page, "Creator approved");

    await page.goto("/admin/learn/videos/new");
    await page.getByLabel("Title").fill(`Modelling a crate in 12 triangles ${RUN}`);
    await page.getByRole("button", { name: "Create video" }).click();
    await page.waitForURL(/\/admin\/learn\/videos\/[0-9a-f-]{36}$/);
    await page.getByLabel("Creator").selectOption({ label: `Example Low Poly Channel ${RUN}` });
    await page.getByLabel("YouTube video").fill("https://youtu.be/AbCdEfGhIjK?t=42");
    await page.getByLabel("What viewers will learn").fill("Blocking out a crate, bevel-free edges and a single texture.");
    await page.getByLabel("Topic").selectOption("Low-Poly Modelling");
    await page.getByLabel("Difficulty").selectOption("beginner");
    await page.getByLabel("Last reviewed").fill("2026-10-17");
    await page.getByRole("button", { name: "Save video" }).click();
    await expectToast(page, "Saved");
    // The link was reduced to its video id.
    await expect(page.getByLabel("YouTube video")).toHaveValue("AbCdEfGhIjK");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectToast(page, "Published");

    await page.goto("/learn");
    await page.getByRole("navigation", { name: "Topic" }).getByRole("link", { name: /Low-Poly Modelling/ }).click();
    await expect(page).toHaveURL(/topic=Low-Poly\+Modelling/);
    await page.getByRole("link", { name: new RegExp(`Modelling a crate in 12 triangles ${RUN}`) }).click();
    await expect(page.locator("iframe")).toHaveCount(0);
    await expectAccessible(page);
    await page.getByRole("button", { name: /Play video/ }).click();
    await expect(page.locator("iframe")).toHaveAttribute("src", "https://www.youtube-nocookie.com/embed/AbCdEfGhIjK?autoplay=1&rel=0");
    await page.getByRole("link", { name: `More from Example Low Poly Channel ${RUN}` }).click();
    await expect(page.getByRole("link", { name: new RegExp(`Modelling a crate in 12 triangles ${RUN}`) })).toBeVisible();
    await expectAccessible(page);

    await page.goto(creatorUrl);
    page.once("dialog", (d) => void d.accept());
    await page.getByRole("button", { name: "Remove approval" }).click();
    await expectToast(page, "Approval removed");
    expect((await request.get(`/learn/videos/modelling-a-crate-in-12-triangles-${RUN}`)).status()).toBe(404);
    expect((await request.get(`/learn/creators/example-low-poly-channel-${RUN}`)).status()).toBe(404);
  });

  test("a reviewed link is listed under its category with its licence note", async ({ page }) => {
    await asAdmin(page, "/admin/resources/new");
    await page.getByLabel("Title").fill(`Example retro palette guide ${RUN}`);
    await page.getByLabel("Link").fill("https://example.com/palettes");
    await page.getByLabel("Category").selectOption("learning");
    await page.getByRole("button", { name: "Create resource" }).click();
    await page.waitForURL(/\/admin\/resources\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("button", { name: "Publish", exact: true })).toBeDisabled();
    await page.getByLabel("Description").fill("How limited palettes were chosen for early 3D games.");
    await page.getByLabel("Licence note").fill("Free to read");
    await page.getByLabel("Last reviewed").fill("2026-10-17");
    await page.getByRole("button", { name: "Save resource" }).click();
    await expectToast(page, "Saved");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    await expectToast(page, "Published");

    await page.goto("/resources");
    const group = page.getByRole("region", { name: "// Learning" });
    const link = group.getByRole("link", { name: new RegExp(`Example retro palette guide ${RUN}`) });
    await expect(link).toHaveAttribute("href", "https://example.com/palettes");
    await expect(group.getByRole("listitem").filter({ has: page.getByRole("link", { name: new RegExp(`Example retro palette guide ${RUN}`) }) }).getByText("Free to read // reviewed 17 Oct 2026")).toBeVisible();
    // Unreviewed starter links stay drafts.
    await expect(page.getByRole("link", { name: /Poly Haven/ })).toHaveCount(0);
  });
});
