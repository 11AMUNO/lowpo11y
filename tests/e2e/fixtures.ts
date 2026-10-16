import type { Page } from "@playwright/test";

/** Matches the seed in scripts/e2e-server.ts. */
export const E2E_ADMIN = { email: "e2e-admin@lowpo11y.test", password: "e2e-admin-password-123" };

export async function signIn(page: Page, next = "/admin") {
  await page.goto(`/auth/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email").fill(E2E_ADMIN.email);
  await page.getByLabel("Password").fill(E2E_ADMIN.password);
  await page.getByRole("button", { name: /Sign in/ }).click();
  await page.waitForURL((u) => u.pathname.startsWith(next));
}
