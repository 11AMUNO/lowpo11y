# 0012 — Launch hardening: static CSP, cookieless counts, verified backups

**Context.** M09 asks for a security review, CDN headers, analytics, storage
budget alarms, automated backups, cross-browser QA and a licences audit,
without accounts or cookies for visitors and on free-tier hosting.

**Decision.**
- **Static Content Security Policy** in `next.config.ts` (built from
  `src/lib/security/headers.ts`): scripts, workers, frames, connections and
  form targets pinned to this site, the public bucket, the R2 upload
  endpoint and youtube-nocookie.com; `object-src 'none'`,
  `frame-ancestors 'none'`, HSTS on https. Inline scripts are allowed:
  nonces would force every page, including the prerendered tools and the
  Scene Builder, into per-request rendering and off the CDN. zod runs
  `jitless` (all imports go through `@/lib/zod`, enforced by ESLint) so its
  eval probe doesn't trip the policy. E2E proves no page reports a violation.
- **Usage counts, not tracking**: `usage_daily(day, event, subject)` with a
  closed vocabulary (page section, tool, format), sent with `fetch` keepalive (works the same in every engine),
  same-origin only, limited per address (USAGE_EVENTS_PER_HOUR, 600) by a hashed key that is deleted within a
  day, bots and admin pages skipped, Do Not Track / Global Privacy Control
  honoured. Return visits are decided on the device from the last visit's
  date. The admin Usage page derives the plan's success metrics.
- **Daily maintenance** through Vercel Cron with `CRON_SECRET`:
  housekeeping and a storage-budget check that posts to a webhook.
- **Backups** outside Supabase and R2: a scheduled GitHub workflow dumps,
  restores into a scratch Postgres, compares every table's row count and
  keeps the encrypted dump 30 days. CI rehearses the same script each push.
- **Security review fixes**: same-origin post-login redirects; editors
  limited to drafts for child rows too (RLS + route checks); sign-in limits
  that can't lock the owner out; content-based ZIP checks; scrypt N=2^17;
  60-day absolute sessions; setup closed once any account exists.
- **Cross-browser**: Firefox and WebKit run a smoke subset in CI (Chromium
  runs everything). 3D-heavy specs stay Chromium-only because headless
  WebGL differs by engine.

**Consequences.**
- The CSP doesn't stop injected inline script; it relies on React's escaping
  and the sanitiser for that, and limits what injected code could reach.
- Counts can't answer per-visitor questions (funnels, retention cohorts), by
  design.
- Backups depend on two GitHub secrets the owner adds; until then the
  workflow warns and does nothing.
