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
derive ───────────────────────────────────────────► FBX → GLB (three.js FBXLoader in Node), software-rendered
                                                    thumbnail, 32–256 px nearest-neighbour texture variants
publish (admin) ──────────────────────────────────► checklist (licence, attestation, files, thumbnail), copy
                                                    published files to the public bucket, build the bundle ZIP
                                                    (files + LICENSE + README + manifest with checksums)
unpublish ────────────────────────────────────────► delete public copies immediately; originals stay private
```

Bulk import (`src/lib/assets/import.ts`) plans assets from a folder listing or
a JSON/CSV manifest, validates the plan against the library (references,
slugs, duplicates by SHA-256) and then runs the same create → store → derive
steps: from the browser at `/admin/import` (through the signed upload flow
above) or from `pnpm import:assets` (server-side). See `docs/IMPORTING.md`.

## Catalogue

- `searchCatalog` (`src/lib/assets/catalog.ts`) runs under the public RLS
  context: full-text (`search_tsv` incl. tag names), prefix (`cra` → crate)
  and typo-tolerant `word_similarity` matching; facets are counted from real
  file metadata with every other active filter applied.
- Listing pages (`/assets`, `/textures`) are link-driven (no client JS needed
  for filters, sort, view or paging); filtered URLs are `noindex`.
- Detail pages load three.js only for the GLB viewer; textures use a CSS
  `image-rendering: pixelated` viewer. Downloads go through
  `/api/download/{fileId}` (counted per day, no visitor data) and redirect to
  the public bucket; packs through `/api/collections/{slug}/download`.
- Loading UIs live in the listing route groups only, so detail pages answer
  with real 404 and 308 status codes.

## Admin

`/admin` pages render under the staff member's RLS context; mutations go
through `src/app/api/admin/*` route handlers, which check the session, the
Origin, the role (publishing, published edits and deletion are admin-only) and
write an audit entry. Editors can draft and submit for review. The database
enforces the same rules again (RLS and publish guards).

## Environments

| | Database | Storage | Data dir |
|---|---|---|---|
| `pnpm dev` | PGlite | local FS | `.data/dev` |
| `pnpm test` | PGlite in-memory (+ Postgres 16 when `TEST_DATABASE_URL` is set) | in-memory / temp dir | temp |
| `pnpm e2e` | PGlite | local FS | `.data/e2e` (reset each run) |
| `pnpm import:assets` | same as the environment it runs in | same | — |
| production | Supabase (`DATABASE_URL`) | R2 | — |

See `DEPLOYMENT.md` for production setup.

The embedded PGlite database belongs to one process at a time: a lock file
(`.data/<env>/pglite.lock`) makes a second process (for example a CLI script
while `pnpm dev` is running) stop with a clear message instead of corrupting
data.
