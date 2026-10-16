import { expect, test } from "@playwright/test";
import { E2E_ADMIN, signIn } from "./fixtures";

test.describe("staff sign-in", () => {
  test("admin area redirects anonymous visitors to sign in", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth\/login\?next=%2Fadmin/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  });

  test("wrong password shows an error and no session is created", async ({ page }) => {
    await page.goto("/auth/login");
    await page.getByLabel("Email").fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill("not-the-password-123");
    await page.getByRole("button", { name: /Sign in/ }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Email or password is incorrect" })).toBeVisible();
    const cookies = await page.context().cookies();
    expect(cookies.find((c) => c.name === "lp_session")).toBeUndefined();
  });

  test("admin signs in, sees the dashboard and signs out", async ({ page }) => {
    await signIn(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
    await expect(page.getByText(/Signed in as Local admin/)).toBeVisible();
    const session = (await page.context().cookies()).find((c) => c.name === "lp_session");
    expect(session?.httpOnly).toBe(true);
    expect(session?.sameSite).toBe("Lax");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth\/login/);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/auth\/login/);
  });

  test("first-time setup is closed once an admin exists", async ({ page }) => {
    await page.goto("/auth/setup");
    await expect(page.getByText("Setup is complete")).toBeVisible();
  });

  test("open redirects are refused", async ({ page }) => {
    await signIn(page, "/admin");
    await page.context().clearCookies();
    await page.goto("/auth/login?next=//evil.example");
    await page.getByLabel("Email").fill(E2E_ADMIN.email);
    await page.getByLabel("Password").fill(E2E_ADMIN.password);
    await page.getByRole("button", { name: /Sign in/ }).click();
    await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/admin$/);
  });
});

test.describe("journey 10: unauthenticated mutation attempts are refused", () => {
  test("cannot start an upload without a session", async ({ request }) => {
    const res = await request.post("/api/admin/uploads", {
      headers: { Origin: "http://127.0.0.1:3100" },
      data: { assetId: "00000000-0000-4000-8000-000000000000", purpose: "delivery", filename: "x.glb", size: 10, contentType: "model/gltf-binary" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("cross-site requests are blocked even with a valid session", async ({ page }) => {
    await signIn(page);
    const res = await page.request.post("/api/admin/uploads", {
      headers: { Origin: "https://evil.example" },
      data: { assetId: "00000000-0000-4000-8000-000000000000", purpose: "delivery", filename: "x.glb", size: 10 },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).error.message).toMatch(/did not come from this site/);
  });

  test("forged storage tokens cannot write or read objects", async ({ request }) => {
    const put = await request.put("/api/storage/upload?token=eyJrZXkiOiJhc3NldHMvYSJ9.forged", { data: "x", headers: { "Content-Type": "text/plain" } });
    expect(put.status()).toBe(403);
    const get = await request.get("/api/storage/object?token=bogus.token");
    expect(get.status()).toBe(403);
  });

  test("private and unknown objects are not served from /files", async ({ request }) => {
    for (const path of ["/files/staging/00000000-0000-4000-8000-000000000000/incoming", "/files/../.data/app-secret", "/files/assets/x"]) {
      const res = await request.get(path);
      expect(res.status(), path).toBe(404);
    }
  });

  test("health check reports the database", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(await res.json()).toMatchObject({ ok: true, db: "ok", storage: "local" });
  });
});
