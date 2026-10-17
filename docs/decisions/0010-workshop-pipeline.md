# 0010 — The Workshop is an ordered step list on a dependency-graph core

**Context.** The plan asks for a non-destructive, node-based or ordered-step
editor whose state is versioned JSON, executed as a typed dependency graph
with cycle checks, hash-based caching of intermediate results, workers,
progress and cancel; it allows shipping a reorderable step list first if a
visual graph editor proves costly, as long as the core graph is reusable.
It also asks that individual tools and the Workshop share algorithms rather
than fork them.

**Decision.**
- **UI: an ordered step list**, each step switchable off without losing its
  settings, with an optional atlas step that always runs last and reads
  every image. A visual node editor is left for later; the plan's step set
  is linear per image except the atlas join, which the list expresses fully.
- **Core: a generic graph executor** (`src/lib/workshop/graph.ts`):
  topological order, cycle and missing-input checks, keys derived from each
  node's identity (step type + settings) and its inputs' keys, on-demand
  evaluation (safe when a cached value is evicted mid-run), progress and
  cancellation between nodes. `run.ts` turns a pipeline into nodes:
  source → enabled steps per image, plus an atlas node over all images.
  Editing step 4 reuses steps 1–3 from the cache.
- **Steps wrap the shared processing core** (resample, the converter's
  colour adjust and grain, remap, OKLab palette extraction, decal bleed,
  atlas packing, the Seamless engine). A unit test shows a Workshop pipeline
  produces byte-identical output to the retro converter with the same
  settings.
- **Pipeline files**: `{format: "lowpo11y-workshop", version: 1, …}`.
  Loading validates every step's settings with defaults for anything missing
  or out of range (and says what it changed), refuses unknown steps and
  newer versions, and has a migration hook per version.
- **Workers**: one long-lived worker serves previews with a 320 MB
  size-bounded LRU cache; batch export uses a pool of 1–4 workers, one image
  per job. The Seamless step runs the owner's engine on an OffscreenCanvas
  inside the worker.
- **Reproducible exports**: deterministic names (`{name}`, `{n}`, folders
  kept, collisions numbered), a fixed ZIP timestamp, and a manifest without
  timestamps, so the same images and pipeline give the same ZIP bytes. The
  manifest lists every source (with SHA-256 of its pixels and, for library
  textures, the asset and licence), every output (size, bytes, SHA-256),
  failures, and the atlas. A failed image is reported, never fatal.
- **Privacy**: recipes and the session's pipeline live in localStorage.
  Images are kept (in IndexedDB) only when the visitor turns on "Keep images
  on this device"; turning it off deletes them. Nothing is uploaded. Cloud
  sync is not built: the site has no visitor accounts.

**Consequences.**
- The same graph can drive a node editor later without changing the core.
- E2E journey 8 compares each exported PNG with the core run in Node on the
  same input and checks the manifest's checksums and the ZIP's determinism.
- WebP output depends on the browser's encoder (refused where the browser
  can't encode WebP); PNG uses the deterministic encoder from ADR 0008.
