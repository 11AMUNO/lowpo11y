# 0003 — First-party session auth instead of Supabase Auth

**Context.** The plan suggests Supabase Auth with server-enforced roles. At
launch only the owner (and possibly editors) sign in; visitor accounts are
optional and deferred. Supabase Auth adds redirect URL, SMTP and JWT-secret
configuration that the owner would need to manage, and would tie authorisation
to one vendor.

**Decision.** Email + password accounts stored in `users` (scrypt hashes via
Node's `crypto`), opaque random session tokens in an HttpOnly, SameSite=Lax,
Secure cookie, with only a SHA-256 hash of the token stored in `user_sessions`.
Roles: `admin`, `editor`, `user`. Every mutating route checks the session and
role on the server and also runs under RLS (ADR 0002). State-changing requests
verify the `Origin` header. Login and upload-signing are rate limited in the
database so limits hold across serverless instances.

The first admin is created with `pnpm admin:create` or through `/admin/setup`,
which only works while no admin exists and only with the `SETUP_TOKEN`
environment variable.

**Consequences.** One less external service; works with any Postgres host.
Password reset is an owner CLI operation until email delivery is configured.
Supabase Auth can still be adopted later by mapping its user id to `users.id`.
