# Release checklist

Work through this before the site goes public, and again (the "every
release" part) before each significant deploy. Each line says how to check
it. Setup steps are in [DEPLOYMENT.md](DEPLOYMENT.md).

## Once, before launch

**Accounts and configuration**
- [ ] Supabase project, R2 buckets (private + public with custom domain) and Vercel project exist (DEPLOYMENT.md sections 1–3).
- [ ] Vercel production variables set: `DATABASE_URL`, `APP_SECRET`, `NEXT_PUBLIC_APP_URL` (https), `STORAGE_PROVIDER=r2`, the `R2_*` set, `CRON_SECRET`, `STORAGE_BUDGET_GB`, optional `ALERT_WEBHOOK_URL`.
- [ ] R2 CORS rules on both buckets list the production origin only (sections 2b, 2c).
- [ ] Admin account created at `/auth/setup`; `SETUP_TOKEN` then deleted from Vercel.
- [ ] Custom domain live; `NEXT_PUBLIC_APP_URL` matches it; redeployed.

**Backups and alerts**
- [ ] GitHub secrets `BACKUP_DATABASE_URL` and `BACKUP_PASSPHRASE` set; **Database backup** workflow run by hand and green; passphrase stored in a password manager.
- [ ] One restore tried from a downloaded artifact into a scratch database (DEPLOYMENT.md section 9).
- [ ] Original asset files copied somewhere other than R2.
- [ ] Cloudflare R2 usage notification and an uptime monitor on `/api/health` set up.
- [ ] Vercel → Settings → Cron Jobs shows `/api/cron/daily`; one run listed with status 200.

**Content and rights**
- [ ] Every asset to publish has a licence you chose, an ownership attestation, and credit text where the licence needs it (the editor won't publish without them).
- [ ] Delivered owner assets: rights confirmed for the wood textures and the Tripo-generated models (plan/licence), or they stay drafts.
- [ ] Draft shaders tested in their engine before publishing; draft resource links reviewed.
- [ ] Privacy, terms, licences and contact pages read through; contact email set (`NEXT_PUBLIC_CONTACT_EMAIL`).

## Every release

- [ ] CI green on the commit: lint, typecheck, unit/integration on PGlite and Postgres 16, build, backup rehearsal, Chromium E2E (including security headers and accessibility), Firefox/WebKit smoke.
- [ ] Migrations: Vercel's build runs them (`pnpm vercel-build`); check the deploy log shows them applied, or "up to date".
- [ ] `https://your-site/api/health` returns `{"ok":true,"db":"ok","storage":"r2"}`.
- [ ] Response headers on the home page include `Content-Security-Policy`, `Strict-Transport-Security` and `X-Frame-Options: DENY` (browser dev tools → Network).
- [ ] `pnpm audit:licences --deep` against production (`DATABASE_URL` and R2 variables in `.env.local`) reports "All published assets pass".
- [ ] Smoke by hand, signed out: search → open a model → 3D preview loads → download ZIP opens with LICENSE.txt; open one tool and save a file; open the Scene Builder and add a model.
- [ ] Signed in: dashboard loads; **Admin → Licences audit** all clear; **Admin → Usage** shows today's counts.
- [ ] After any takedown: the file's URL purged from the Cloudflare cache.
