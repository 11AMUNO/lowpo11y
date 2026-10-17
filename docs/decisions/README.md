# Architecture decision records

Each file records a decision that deviates from, or makes concrete, the master
build plan (`docs/MASTER_BUILD_PLAN.md`). Format: context → decision →
consequences. Superseded records stay in place with a pointer to the newer one.

| # | Decision | Status |
|---|----------|--------|
| [0001](0001-single-app-src-modules.md) | Single Next.js app with `src/` modules instead of a monorepo | Accepted |
| [0002](0002-postgres-pglite-and-rls.md) | Plain SQL migrations; PGlite locally, any Postgres (Supabase) in production; RLS via role switching | Accepted |
| [0003](0003-session-auth.md) | First-party session auth for owner/editor accounts instead of Supabase Auth | Accepted |
| [0004](0004-storage-two-buckets.md) | `AssetStorage` abstraction with private + public buckets; local filesystem adapter | Accepted |
| [0005](0005-next16-without-cache-components.md) | Next.js 16 without `cacheComponents`; explicit dynamic rendering for DB-backed pages | Accepted |
| [0006](0006-ui-stack.md) | Radix primitives + Tailwind tokens, self-hosted fonts, vanilla three.js | Accepted (fonts superseded by 0007) |
| [0007](0007-visual-identity-from-seamless.md) | Visual identity follows the owner's 11AM-Seamless terminal style | Accepted |
| [0008](0008-tool-processing-core.md) | Browser tools share a pure RGBA processing core and a deterministic PNG encoder; Seamless keeps its canvas engine | Accepted |
