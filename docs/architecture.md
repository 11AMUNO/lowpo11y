# Architecture

LOWPO11Y is one Next.js 16 (App Router, TypeScript, Turbopack) application.
Public catalogue pages are server-rendered; creative tools are client islands
that process files locally in the browser (Canvas, Web Workers). The server
never receives visitor files unless a feature explicitly says so.

```
Browser ──► Next.js (route handlers, server components)
              │
              ├─ src/lib/auth      sessions, roles, origin checks, rate limits
              ├─ src/lib/db        driver (PGlite | postgres.js) + RLS context + repositories
              ├─ src/lib/storage   AssetStorage (local FS | Cloudflare R2), keys, signing
              ├─ src/lib/validation Zod schemas shared by forms, APIs and scripts
              │
              ▼
        Postgres (PGlite locally, Supabase in production)
        Object storage (local FS or R2: private + public buckets)

Client tools ──► src/lib/processing (pure pixel algorithms) in Web Workers
               ► src/lib/formats    (GLB, PNG, BMFont, GPL, atlas JSON, ZIP manifests)
```

## Source layout

| Path | Purpose |
|---|---|
| `src/app/(site)` | Public pages with the full header and footer |
| `src/app/(studio)` | Full-height workspaces (individual tools, Workshop, Scene Builder) |
| `src/app/admin` | Owner/editor CMS (session + role gated on the server) |
| `src/app/api` | Route handlers (uploads, downloads, admin mutations, health) |
| `src/components/ui` | Design-system primitives |
| `src/components/site` | Header, footer, navigation, search |
| `src/features/*` | Feature modules (catalog, admin, tools, workshop, scene-builder) |
| `src/lib/*` | Framework-independent modules (see ADR 0001) |
| `supabase/migrations` | SQL schema, RLS policies and seed-safe reference data |
| `scripts/` | migrate, seed, reset, admin:create, vercel-build, e2e server |
| `tests/unit`, `tests/integration`, `tests/e2e` | Vitest and Playwright suites |

## Request contexts and RLS

Every database call names its context:

- `public` — anonymous visitor: `SET LOCAL ROLE lp_anon`
- `user(id, role)` — signed-in staff/user: `SET LOCAL ROLE lp_authenticated` + `app.user_id`, `app.role`
- `service` — server-internal bookkeeping (sessions, rate limits, counters, migrations)

Policies allow anonymous reads of published, non-deleted rows only; staff
writes; admin-only publishing. See ADR 0002 and `supabase/migrations`.

## Upload flow

```
admin browser ──POST /api/admin/uploads──────────► create upload_session, presign PUT (private/staging/{id}/incoming)
admin browser ──PUT bytes────────────────────────► R2 (or /api/storage/upload locally)
admin browser ──POST /api/admin/uploads/{id}/complete
                                                  ► head + read staged object, verify size, sha256, magic bytes,
                                                    purpose allow-list, ZIP entries, image/model analysis
                                                  ► copy to private assets/{assetId}/{purpose}/{fileId}.{ext}
                                                  ► insert asset_files (RLS: staff), audit, delete staging
publish (M03) ────────────────────────────────────► copy published files to the public bucket, build bundle ZIP
```

## Environments

| | Database | Storage | Data dir |
|---|---|---|---|
| `pnpm dev` | PGlite | local FS | `.data/dev` |
| `pnpm test` | PGlite in-memory (+ Postgres 16 when `TEST_DATABASE_URL` is set) | in-memory / temp dir | temp |
| `pnpm e2e` | PGlite | local FS | `.data/e2e` (reset each run) |
| production | Supabase (`DATABASE_URL`) | R2 | — |

See `DEPLOYMENT.md` for production setup.
