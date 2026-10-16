# 0002 — SQL migrations, PGlite locally, Postgres/Supabase in production, RLS via role switching

**Context.** The plan specifies Supabase Postgres with RLS. The owner is new to
Supabase, and development must not block on credentials. RLS must be tested with
"actual unauthenticated and authenticated clients".

**Decision.**
- Schema lives in hand-written, idempotent SQL in `supabase/migrations/`. The
  same files run on PGlite (embedded WASM Postgres), a local Postgres 16 server,
  and Supabase. Supabase's GitHub integration can apply them directly.
- `src/lib/db` exposes one small interface (`query`, `transaction`) with two
  drivers: **PGlite** when `DATABASE_URL` is unset (data under
  `.data/<env>/pglite`), and **postgres.js** when it is set.
- **RLS is enforced for every request made on behalf of a visitor or staff
  member.** The server runs those queries inside a transaction that executes
  `SET LOCAL ROLE lp_anon | lp_authenticated` and sets `app.user_id` /
  `app.role` with `set_config(..., true)`. Policies read these through
  `app.current_user_id()` / `app.current_role()`. Only a short list of
  server-internal operations (session lookup, rate limiting, download counters,
  migrations) run as the owning role.
- Our policies target our own roles (`lp_anon`, `lp_authenticated`), not
  Supabase's `anon`/`authenticated`, and every table has RLS enabled. Supabase's
  public Data API therefore cannot read anything even with the anon key.
- Search uses Postgres full-text (`tsvector` + GIN) with `pg_trgm` for fuzzy
  fallback. No external search service.

**Consequences.** Zero-setup local development (`pnpm dev` just works). RLS is
covered by integration tests that run against PGlite and, in CI, a real
Postgres 16 service container. Supabase is used as managed Postgres; its
dashboard remains useful for backups and inspection.
