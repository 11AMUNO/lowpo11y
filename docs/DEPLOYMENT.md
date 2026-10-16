# Deployment guide

This puts LOWPO11Y online with **Vercel** (runs the website), **Supabase**
(the database) and **Cloudflare R2** (stores files). All three have free tiers
that are enough to launch. Allow about 45 minutes the first time.

> Never paste keys, passwords or connection strings into chat, issues or code.
> They only go into the Vercel environment-variable screen.

Dashboards change over time. If a button described here has moved, look for
the same words nearby; the concepts stay the same.

---

## 0. What you will end up with

| Variable | Where it comes from |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your site address, e.g. `https://lowpo11y.com` (or the `*.vercel.app` address to start) |
| `APP_SECRET` | A random string you generate (step 4) |
| `SETUP_TOKEN` | A second random string, used once to create your admin account |
| `DATABASE_URL` | Supabase (step 1) |
| `STORAGE_PROVIDER` | The word `r2` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Cloudflare (step 2) |
| `R2_PRIVATE_BUCKET`, `R2_PUBLIC_BUCKET`, `R2_PUBLIC_BASE_URL` | Cloudflare (step 2) |

---

## 1. Supabase: the database

1. Open your Supabase project.
2. Click **Connect** at the top of the project dashboard.
3. Choose the **Transaction pooler** connection string (it uses port `6543`).
   Serverless hosts like Vercel need the pooler.
4. Copy the URI. It looks like
   `postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:6543/postgres`.
5. Replace `[YOUR-PASSWORD]` with your database password (Project Settings →
   Database shows a reset button if you have forgotten it). This full string
   is your `DATABASE_URL`.

**Schema.** You don't run anything by hand. Production builds on Vercel apply
`supabase/migrations/*.sql` before building. If you also turned on Supabase's
GitHub integration, it may apply the same files; they are written to be safe
to apply twice.

**What Supabase features are used.** Only the database. Supabase Auth and
Storage are not used (see `docs/decisions/0003` and `0004`). Every table has
row-level security turned on, so Supabase's public "Data API" can't read any
LOWPO11Y data even with the public anon key.

**Backups.** Supabase takes daily backups on paid plans. On the free plan,
download a backup from Database → Backups occasionally, or run
`pg_dump "$DATABASE_URL" > backup.sql` from your computer.

---

## 2. Cloudflare R2: file storage

You need **two buckets**: a private one for uploads and unpublished files,
and a public one for published files. (You already created one; use it as the
private bucket.)

### 2a. Buckets

1. Cloudflare dashboard → **R2 Object Storage**.
2. Your existing bucket becomes `R2_PRIVATE_BUCKET`. Leave **public access
   off** for it.
3. **Create bucket** → name it e.g. `lowpo11y-public`. This is
   `R2_PUBLIC_BUCKET`.
4. Open the public bucket → **Settings** → **Public access**:
   - Best: **Custom domain** → connect e.g. `files.yourdomain.com` (your domain
     must be on Cloudflare). Then `R2_PUBLIC_BASE_URL=https://files.yourdomain.com`.
   - To start without a domain: enable the **r2.dev subdomain** and use the
     `https://pub-….r2.dev` address shown. Cloudflare rate-limits r2.dev, so
     switch to a custom domain before real traffic.

> One bucket only? It works: leave `R2_PUBLIC_BUCKET` and
> `R2_PUBLIC_BASE_URL` empty. Published files are then served through the
> site with short-lived signed links, which can't be cached at Cloudflare's
> edge. Fine for testing, not recommended for launch.

### 2b. CORS on the private bucket

The admin uploads files straight from your browser to the private bucket, so
the bucket must accept your site. Private bucket → **Settings** → **CORS
policy** → **Add/Edit** and paste (replace the origins):

```json
[
  {
    "AllowedOrigins": ["https://lowpo11y.com", "https://your-project.vercel.app"],
    "AllowedMethods": ["PUT", "GET", "HEAD"],
    "AllowedHeaders": ["Content-Type", "Content-Length"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

### 2c. API token

1. R2 overview → **Manage R2 API Tokens** (or "API" → "Manage API tokens").
2. **Create API token** → permission **Object Read & Write** → limit it to
   your two buckets → create.
3. Copy the **Access Key ID** (`R2_ACCESS_KEY_ID`) and **Secret Access Key**
   (`R2_SECRET_ACCESS_KEY`). The secret is shown once.
4. Your **Account ID** is on the R2 overview page (`R2_ACCOUNT_ID`).

---

## 3. Vercel: the website

1. vercel.com → **Add New… → Project** → import the `lowpo11y` GitHub repo.
2. Framework preset: **Next.js**. The build command comes from `vercel.json`
   (`pnpm vercel-build`), which migrates the database on production deploys.
3. Before the first deploy, open **Environment Variables** and add everything
   from the table in step 0. Scope `DATABASE_URL` and the `R2_*` values to
   **Production** (and Preview only if you want previews to share production
   data — usually not).
4. Deploy.

---

## 4. Secrets you generate

Run this twice on any computer with Node.js and use the outputs for
`APP_SECRET` and `SETUP_TOKEN`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Or use any password manager's generator (40+ characters).

---

## 5. Create your admin account

1. Visit `https://your-site/auth/setup`.
2. Enter the `SETUP_TOKEN`, your name, email and a password (12+ characters).
3. You are signed in to `/admin`. The setup page now refuses to run again.
   You may delete `SETUP_TOKEN` from Vercel afterwards.

Forgot your password? From a computer with the repo:
`DATABASE_URL="…" pnpm admin:create --email you@example.com --name "You"`
resets it (and signs out all sessions).

---

## 6. Check it

- `https://your-site/api/health` should return `{"ok":true,"db":"ok","storage":"r2"}`.
- In `/admin`, the dashboard shows **Database: Postgres** and **Provider: Cloudflare R2**.

## 7. Custom domain

Vercel → Project → **Settings → Domains** → add your domain and follow the DNS
instructions. Then update `NEXT_PUBLIC_APP_URL` and the R2 CORS origins, and
redeploy.

---

## Running locally

```bash
pnpm install
pnpm db:seed     # local admin: admin@lowpo11y.local / lowpo11y-local-admin
pnpm dev         # http://localhost:3000, admin at /admin
pnpm db:reset    # wipe local data and start again
```

Local data lives in `.data/dev/` (git-ignored). To try the app against your
real Supabase or R2 from your computer, put the variables in `.env.local`.

## Operations checklist

- Uptime: point a monitor (e.g. Better Stack, UptimeRobot) at `/api/health`.
- Cloudflare: set an R2 usage notification under **Notifications** so storage
  or operation spikes don't surprise you.
- Supabase: watch Database → Reports for connection and size limits.
- Keep a copy of important original assets somewhere other than R2.
