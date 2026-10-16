# 0005 — Next.js 16 without `cacheComponents`

**Context.** Next.js 16.4's starter enables `cacheComponents` and
`partialPrefetching`. Cache Components makes all data dynamic by default,
requires Suspense boundaries around uncached I/O at prerender time, and keeps
navigated-away routes mounted (hidden) via `<Activity>`.

**Decision.** Leave `cacheComponents` off and use the established model:
static pages where content is static (tools, legal pages), and
`dynamic = "force-dynamic"` for pages that read the database. Heavy client tools
(three.js viewers, the scene editor) should unmount on navigation so GPU
resources are released predictably.

The build never touches the database. This also matters for PGlite, which is a
single-process embedded database and cannot be opened by parallel build workers.

**Consequences.** Simpler mental model; catalogue pages are server-rendered per
request with `Cache-Control` headers. CDN or `unstable_cache` caching can be
added once real traffic shows the need. Revisit when Cache Components becomes
mandatory in the next major version.
