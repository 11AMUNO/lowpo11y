# 0001 — Single Next.js app with `src/` modules

**Context.** The plan suggests `apps/web` plus `packages/processing-core`,
`packages/file-formats`, `packages/scene-schema` and `packages/ui`, but
explicitly allows simplifying to `src/` while one app is sufficient.

**Decision.** One Next.js app at the repository root. The "packages" live as
framework-independent modules under `src/lib/`:

| Plan package | Location | Rule |
|---|---|---|
| `processing-core` | `src/lib/processing/` | Pure TypeScript over `{width,height,data}` pixel buffers. No DOM, no React. Shared by every tool, the Workshop and Web Workers. |
| `file-formats` | `src/lib/formats/` | GLB/glTF parsing and writing, PNG helpers, BMFont, GPL palettes, atlas JSON, manifests. |
| `scene-schema` | `src/lib/scene/` | Versioned `.retro-scene.json` schema + migrations (Zod). |
| `ui` | `src/components/ui/` | Design-system primitives. |

**Consequences.** One lockfile, one build, one test runner. The `src/lib/*`
modules must not import from `src/app`, `src/components` or Next.js APIs so they
can be extracted into packages later without changes. ESLint boundaries can be
added if this starts to drift.
