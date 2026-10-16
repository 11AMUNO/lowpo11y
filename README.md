# LOWPO11Y

Free low-poly models and textures, browser-based retro texture tools, engine
shaders and starter projects, and a browser scene builder for PS1, PS2 and
N64-inspired games.

> Status: under active development. See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)
> for what works today and how it was verified.

## Quick start

Requirements: Node 22+, pnpm 10 (`corepack enable`).

```bash
pnpm install
pnpm dev            # http://localhost:3000
```

No external services are needed for development. With no `DATABASE_URL` set,
the app uses an embedded Postgres (PGlite) and stores files on disk under
`.data/dev/`.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | Route type generation + `tsc --noEmit` |
| `pnpm test` | Unit and integration tests (Vitest) |
| `pnpm e2e` | Browser tests (Playwright) against a fresh seeded production build — run `pnpm build` first |
| `pnpm check` | lint + typecheck + test |

## Documentation

- [Master build plan](docs/MASTER_BUILD_PLAN.md) — the product specification
- [Implementation status](docs/IMPLEMENTATION_STATUS.md)
- [Architecture](docs/architecture.md) and [decision records](docs/decisions/)
- [Design system](docs/DESIGN_SYSTEM.md)
