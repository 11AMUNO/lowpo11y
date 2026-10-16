# Implementation status

Living record of what is built, how it was verified, and what is outstanding.
Updated at the end of every milestone. Spec: `docs/MASTER_BUILD_PLAN.md`.

_Last updated: 2026-10-16_

## Milestones

| Milestone | Status | Evidence |
|---|---|---|
| M00 Discovery & setup | ✅ Done | lint, typecheck, unit, build, E2E smoke all pass locally; CI workflow committed |
| M01 Public shell & design system | ⏳ Next | — |
| M02 Infrastructure (DB, RLS, auth, storage, uploads) | ⬜ Not started | — |
| M03 Asset CMS + catalogue | ⬜ Not started | — |
| M04 Initial processing tools | ⬜ Not started | — |
| M05 Advanced tools | ⬜ Not started | — |
| M06 Resources & curated video directory | ⬜ Not started | — |
| M07 Asset Workshop | ⬜ Not started | — |
| M08 Scene Builder alpha | ⬜ Not started | — |
| M09 Stabilisation & deploy | ⬜ Not started | — |

## M00 — Discovery and setup

**Findings**
- Repository contained only the build plan (`Master-Plan.MD`). No existing
  code, framework or seamless-texture tool. A formatted copy of the plan lives
  at `docs/MASTER_BUILD_PLAN.md`.
- Owner has created an R2 bucket and a Supabase project linked to GitHub
  (2026-10-16). Credentials have not been shared and should not be pasted into
  chat; they go into host environment variables at deploy time.
- Owner has local textures, models and a seamless texture tool; integration
  pending delivery of a sample pack and the tool source.

**Built**
- Next.js 16.4.2 + React 19.3 + TypeScript 5.9 (strict), Tailwind CSS 4.3,
  ESLint 9 flat config (`eslint-config-next`), Vitest 4, Playwright 1.56.1
  (matches the pre-installed Chromium), pnpm 10, Node 22.
- Design tokens (dark default, light theme), type scale, self-hosted fonts.
- `/api/health`, E2E server harness (`scripts/e2e-server.ts`).
- GitHub Actions CI: lint → typecheck → unit/integration (with a Postgres 16
  service) → build → Playwright.
- Docs: architecture, design system, ADRs 0001–0006.

**Verified**: PGlite supports roles, `SET LOCAL ROLE`, RLS policies,
`set_config`, full-text search, `pg_trgm`, array and JSONB parameters — the
basis for ADR 0002. A local Postgres 16 server is used for driver tests.

**Toolchain notes**
- TypeScript 7 (native port) is the npm `latest` but is pinned to 5.9 for
  Next.js/typescript-eslint compatibility.
- Next.js 16 removed `next lint`; `pnpm lint` runs ESLint directly.
- `pnpm typecheck` runs `next typegen` first so `PageProps`/`LayoutProps`
  globals exist.

## Decisions log

See `docs/decisions/`.

## Blocked on owner

| Item | Needed for | Workaround meanwhile |
|---|---|---|
| Seamless texture tool source | T01 integration | Compatible placeholder implementation (M04), clearly labelled |
| Small sample asset pack + rights notes | Calibrating previews and ingest | Generated geometric demo props and procedural textures owned by the project, tagged demo-only |
| Production env vars (Supabase `DATABASE_URL`, R2 keys, `APP_SECRET`) | Deployment | Local PGlite + filesystem storage |
| Domain name | Canonical URLs, R2 public domain | `NEXT_PUBLIC_APP_URL` placeholder |
| Licence choice for owner originals | Publishing owner assets | Demo content uses CC0 |
