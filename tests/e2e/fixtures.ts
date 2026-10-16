import { test, type Cookie, type Page } from "@playwright/test";

/** Matches the seed in scripts/e2e-server.ts. */
export const E2E_ADMIN = { email: "e2e-admin@lowpo11y.test", password: "e2e-admin-password-123" };

/** Signs in through the form. Use only where the sign-in UI is under test: logins are rate limited. */
export async function signIn(page: Page, next = "/admin") {
  await page.goto(`/auth/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next));
}

let session: Cookie[] | null = null;

/** Opens `next` as the E2E admin, signing in once per worker and reusing the session cookie after that. */
export async function asAdmin(page: Page, next = "/admin") {
  if (session) {
    await page.context().addCookies(session);
  } else {
    const base = test.info().project.use.baseURL!;
    const res = await page.request.post("/api/auth/login", { data: { ...E2E_ADMIN, next }, headers: { Origin: new URL(base).origin } });
    if (!res.ok()) throw new Error(`E2E admin sign-in failed: ${res.status()} ${await res.text()}`);
    session = (await page.context().cookies()).filter((c) => c.name === "lp_session");
  }
  await page.goto(next);
}
