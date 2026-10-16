# RETRO.DEV — MASTER BUILD PLAN

**Working title:** Retro.Dev (placeholder; branding and domain to be configured)
**Version:** 1.0 — 16 October 2026
**Audience:** Claude Code/Claude Cloud implementation agent, project owner, future contributors
**Status:** Build specification, not evidence the project has been implemented.

> **MISSION:** Build a polished, fast, free-first web platform for PS1/PS2/N64-inspired and general low-poly indie game developers. Combine a curated downloadable asset library, client-side image and audio tooling, downloadable shaders/templates, a creator discovery directory, a saved multi-step asset-processing workbench, and ultimately a browser-based 3D scene builder. The owner already has large private prop/texture collections and an existing seamless texture tool; do not assume they have been supplied. Build ingestion and replacement interfaces, not fabricated assets.

---

## 0. Instructions for the autonomous development agent

Act as staff software engineer, product designer, QA lead, security reviewer, and technical writer. Implement this application incrementally as a working product, not a collection of decorative mockups. Follow all requirements below unless a technically justified deviation is documented in `docs/decisions/`. Do not block development waiting for third-party keys or owner assets. Supply local development adapters, seeded demo content clearly labelled as placeholders, and `.env.example` files. Never fabricate real third-party asset licensing, claim a simulation is hardware-accurate without verification, or expose service keys to the browser.

Execution loop for each milestone:
1. Review repository and maintain `docs/IMPLEMENTATION_STATUS.md` with completed/in-progress/blocked features and honest evidence.
2. Write or update schema, typed contracts, tests, server validation and documentation.
3. Implement functionality end-to-end with useful empty/error/loading states and accessibility.
4. Run lint, typecheck, unit tests, integration tests, production build, and browser E2E tests where feasible.
5. Address failures; include screenshots where practical; record unresolved limitations.
6. Commit cohesive work, update status, then proceed to the next milestone.

Do not skip directly to the complex scene editor before delivering core browsing, storage, and asset workflows. Do not use expensive external AI APIs as hidden dependencies. Avoid proprietary branding and copyrighted artwork in sample data. All actual uploaded resources require verified provenance and a chosen licence. The site must remain usable with an empty library.

### Explicit non-goals for initial launch
- Not a full game engine, user-generated executable-script marketplace, video-hosting platform, or multiplayer 3D editor.
- No community uploads, selling assets, subscriptions, complex social features or automatic model-retopology at launch.
- No unverified claims of exact original-console texture, memory or polygon limitations.
- No conversion of arbitrary `.blend`/`.fbx` in a browser unless safe and actually supported; prefer GLB previews and original-file downloads.
- No user-generated materials published without moderation and documented rights.

---

## 1. Product principles, target users, and positioning

Primary audiences: (a) hobbyists making retro horror and PSX-inspired games in Godot, Unity or Unreal; (b) Blender artists building optimised low-poly assets; (c) game-jam developers who need quick usable production assets; (d) artists working toward PS2/N64-era or lo-fi modern looks. Core value: **find → preview → process → export → use in-engine** from a single site. Maintain a distinction between **historically documented console behaviour** and **modern stylised interpretation**.

Product principles: zero-login access for catalogue browsing, local tool processing and free downloads; fast previews; reproducible downloadable outputs; transparent licence terms; excellent filtering; owner-friendly content management; no arbitrary external uploads on launch; mobile-responsive content with desktop-optimised editors; user privacy; no deceptive download walls.

Success metrics: successful asset download rate; library search-to-download conversion; percentage of tools completing export; page performance; repeat usage; error rate for 3D previews; number of assets with complete metadata/licences; scene-editor session success. Avoid vanity metrics in favour of task completion.

## 2. Scope matrix and rollout

**P0 — Foundation / launchable core:** React/Next.js design system; responsive navigation; public asset and texture catalogue; detailed previews; filtering, search and download; secure admin CMS; R2-compatible object storage; Supabase/Postgres metadata; bulk ingest tooling; seamless-texture tool integration; image resizer; simple palette reduction/dithering; a small verified curated resource directory; legal pages; analytics, SEO and operational checks.

**P1 — Signature tools and libraries:** Texture atlas builder; colour palette generator; advanced PSX texture converter; low-poly GLB model inspector; bitmap font generator; decal/transparency creator; shaders and starter projects index with download bundles; Godot/Blender/Unity sample resources; well-structured tutorial/creator directory; more catalogue asset types.

**P2 — Asset Workshop:** Upload or choose an asset; configurable non-destructive processing graph; shared preview; saved presets and local-session restore; batch processing; deterministic exports with manifest; texture/atlas/decal workflows.

**P3 — Browser Scene Builder (alpha):** three.js-based scene editor; local assets and allowed hosted GLB/GLTF; asset placement and transforms, hierarchy, grouping, snap, duplication, basic materials, lighting/fog and retro preview presets; local scene JSON save/open and GLB export. Follow with project persistence and more sophisticated scene tooling after alpha is stable.

**P4 — Expansion:** audio bitcrusher, skybox/cubemap, spritesheet utilities, normal-map utilities, animation helpers, richer community directory, asset bundles, import/export pipeline improvements, moderation-supported community uploads only if owner chooses.

Each phase is complete only when tests pass and a user can finish a real end-to-end workflow.

---

## 3. Site information architecture

Top navigation: **Assets | Textures | Tools | Shaders & Code | Learn | Resources | Scene Builder**. Prominent global search. Header may compress on small screens; no fake disabled links.

Suggested routes:
- `/` landing page: search, featured collections, flagship tools, new assets, starter projects, creator highlights.
- `/assets`, `/assets/[slug]`, `/collections`, `/collections/[slug]`.
- `/textures`, `/textures/[slug]` (shares asset infrastructure with texture-centric filters).
- `/tools`, `/tools/seamless`, `/tools/texture-converter`, `/tools/texture-atlas`, `/tools/palette`, `/tools/model-inspector`, `/tools/bitmap-font`, `/tools/decal`, plus later tools.
- `/workshop`, `/scene-builder`.
- `/shaders`, `/shaders/[slug]`, `/starter-projects`, `/starter-projects/[slug]`.
- `/learn`, `/learn/creators`, `/learn/videos/[slug]`, `/resources`.
- `/about`, `/licences`, `/privacy`, `/terms`, `/contact`.
- `/auth/login`, `/account` (optional for saved presets), `/admin` and nested CMS views.

Information architecture should allow filtering and cross-linking: a wall material can appear in a texture category, a modular environment collection, a specific asset's dependencies, and a tutorial about atlases.

## 4. Visual and UX direction

Visual aesthetic: premium understated retro-technical workstation, inspired by late-80s/90s game development and industrial UI, not generic neon cyberpunk. Dark charcoal/near-black surfaces, warm off-white text, muted red/orange or restrained amber accents, subtle grid/tick marks, minimal tasteful scanline motifs. Content and thumbnails remain legible. Use excellent typography, spacing and hierarchy; prioritize real imagery over decoration. Responsive layout and keyboard-friendly interactions. Support dark as default, light if feasible. Accessible contrast and no gratuitous animation. Tool canvases should maximize work area with collapsible inspector panels.

Core components: header, mega navigation, search command panel, asset card, model thumbnail, tag chips, filter panel, file-type badge, licence badge, viewer, download dialog, upload dropzone, adjustable numeric control, colour selector, layer list, tool history, toast, progress indicator, empty states, retry states, admin form, table and pagination. Standardised image display with contain for tiles/model packs as applicable. Full keyboard navigation, proper labels, focus ring, ESC behaviour and descriptive alt text.

## 5. Recommended technical architecture

**App:** Next.js App Router + React + TypeScript, Tailwind CSS and accessible headless UI components. Choose an actively maintained UI kit and document choice. Use server rendering/static generation for public catalogue pages; client-side islands for creative tools. Strict lint/type checks. Web APIs and Web Workers for image processing. Use three.js and React Three Fiber for model viewing and scene editor when they meaningfully simplify rendering; prevent enormous bundle sizes by code-splitting.

**Database and auth:** Managed Supabase PostgreSQL and Supabase Auth, with server-enforced owner/admin role checks and database RLS. Unauthenticated read of published assets only. Start with anonymous local tool use; optional sign-in for cloud presets and favourites. Do not rely on hidden UI routes for authorisation. Prefer Postgres full-text and indexes first; adopt dedicated hosted search only after proven need.

**File storage:** Cloudflare R2, S3-compatible APIs and public custom-domain delivery for published previews/downloads. Private staging/quarantine bucket or separate prefix for owner uploads; strict permissions; no public read before publishing. For large files use server-generated short-lived presigned PUT uploads with type/size constraints, CORS, checksums and a post-upload verification step. Presigned URLs must never be treated as authentication for CMS mutation. Signed operations should use the R2 S3 API endpoint; custom domains serve public approved content.

**Hosting:** Deploy Next.js to a supported hosting provider with good App Router compatibility; Vercel is simplest for Next.js. Cloudflare deployment is possible, but verify current framework/runtime compatibility before committing. Use R2 for object storage regardless of where app runtime is hosted. Avoid tightly coupling data access to host proprietary APIs. Configure custom domain, TLS, preview deployments and CI.

**Processing:** Default image tools run entirely in browser via Canvas, ImageData, WebGL/WebGPU or WASM when appropriate. Offload expensive operations to Web Workers and cancel/terminate them safely; report progress. Avoid sending visitor images to server by default. For inherently server-side tasks, use a job queue/worker with strict quotas, object validation, timeouts, and explicit opt-in. Use reasonable upload/pixel/memory caps for client processing. Do not promise unlimited batch size.

**3D formats:** GLB/GLTF as canonical interactive asset format. Original `.blend`, `.fbx`, `.obj`, `.zip` may be offered as downloads when provided and licensed. A source `.blend` does not automatically yield a browser preview without a conversion workflow. `GLTFLoader` for display, `GLTFExporter` for supported scene exports. Shader-specific settings generally will not survive GLB export: export standard materials and save editor-specific metadata separately.

**Observability:** Sentry or equivalent error monitoring; privacy-sensitive event analytics; uptime checks; job logs and storage audit trail. No asset content or private upload URLs in telemetry.

**Security:** server input validation with Zod or similar; MIME, extension, magic bytes and size validation; malware scanning or isolated processing for owner/contributor uploads where feasible; sanitize descriptions, filenames, SVGs and rich text; forbid executable archives from public auto-preview; CSP, safe CORS, secure cookies, rate limiting for auth/admin/signing, RBAC and RLS. Protect SSRF for any remote URL ingestion. Never expose R2 keys, database service-role keys, or admin tokens client-side.

---

## 6. Cloud storage, hosting and asset organisation

Storage object keys, examples:
```
assets/{asset-id}/source/model.blend
assets/{asset-id}/delivery/model.glb
assets/{asset-id}/delivery/model.zip
assets/{asset-id}/textures/albedo_128.png
assets/{asset-id}/preview/thumb.webp
assets/{asset-id}/preview/hero.webp
assets/{asset-id}/preview/turntable.webp
textures/{asset-id}/source/original.png
textures/{asset-id}/delivery/64.png
textures/{asset-id}/delivery/128.png
textures/{asset-id}/delivery/256.png
packs/{pack-id}/pack-v1.zip
shaders/{shader-id}/v1/source.zip
user-private/{user-id}/presets/... (if cloud presets are enabled)
staging/{upload-session-id}/incoming
```
Use immutable IDs, not display titles, for storage keys. Record version and checksum, ownership, upload status, byte size, dimensions, MIME, storage provider/key, and CDN URL derivation. Never trust a user-supplied storage object path. Image derivatives should be generated once per source or cached behind versioned URLs; ensure thumbnails don't load huge originals.

Owner workflow: admin selects type → uploads sources and previews → server generates/validates derivations → metadata review → explicit licence/provenance declaration → preview in catalogue → publish. Download buttons pull from stored files, not fabricated filenames. Asset removals are soft-delete/unpublish first; background cleanup and versioning protect against accidental deletion.

Bulk ingest: support CSV/JSON manifest + file directory mapping; validate dependencies, licence and missing files; deduplicate by checksum; calculate texture dimensions and model stats when reliable; bulk generate previews where tooling allows; show dry-run and post-import report; safe resume after interruption. Do not try to infer and certify rights from filenames. Assets without a rights record remain private/unpublished.

For early development, use an `AssetStorage` abstraction with `LocalFilesystemStorage` for dev/demo and `R2Storage` for production. Seed generated geometric demo props and checker textures that the project itself owns; clearly tag demo-only. Provide instructions for switching providers.

### Practical cost and risk controls
- Track storage bytes, GET/PUT operations, requests, processed bytes and CDN/cache hit ratio.
- Enable budget alerts and traffic abuse protection; rate limit automated high-volume download scraping if needed without preventing normal use.
- Default public read for approved assets; use private signed GET only for restricted or unpublished material.
- Estimate costs under realistic download traffic rather than only multiplying GB stored; avoid surprise operation bills.
- Cache thumbnails at edge. Keep backups of database and important originals, ideally separate from a single object-store account.

---

## 7. Data model (migration-ready PostgreSQL)

Core tables, with UUID PKs, created/updated timestamps, soft deletion where useful:

**profiles** `(id auth_user_id, display_name, role enum[user,editor,admin], avatar_key, created_at)`.

**assets** `(id, slug UNIQUE, title, short_description, description_md, category_id, asset_type enum[model,texture,decal,sprite,ui,audio,skybox,animation,pack], status enum[draft,review,published,archived], creator_id, licence_id, attribution_text, licence_source_url, provenance_notes, ownership_attested_at, featured, download_count_aggregated, published_at, created_at, updated_at)`.

**asset_files** `(id, asset_id, version, purpose enum[source,delivery,thumbnail,preview,dependency], storage_key, original_filename, format, mime, size_bytes, sha256, width, height, channels, model_triangle_count, model_vertex_count, texture_count, animation_count, lod, is_primary, published, created_at)`.

**categories**, **tags**, **asset_tags**; category tree and curated taxonomies such as style (PSX-inspired, N64-inspired, PS2-inspired, general low-poly), subject, setting, texture size and file format.

**licences** `(id, code, human_label, canonical_url, commercial_use, modifications, attribution_required, redistribution_allowed, notes)`. Never infer clauses for custom licences. Explicit `unknown` blocks public downloads until resolved.

**collections**, **collection_assets**, **creators**, **asset_creators**, **attributions**. Link sources and contributors.

**shader_resources** `(id, slug, title, engine, engine_version_min/max, renderer_compatibility, licence_id, explanation, preview_asset_id, download_file_id, source_url, status)`.

**starter_projects** `(id, slug, title, engine, engine_versions, description, included_features, licence_id, file_id, source_url, status)`.

**tutorial_creators** `(id, name, youtube_channel_url, channel_id_optional, avatar_external_url, description, categories, approved, attribution_notes)`; **tutorials** `(id, creator_id, title, youtube_video_id, external_url, summary, difficulty, engine, topic, featured, status, published_at)`.

**tools** `(id, slug, name, summary, route, processing_mode, version, enabled, featured)`.

**presets** `(id, user_id nullable for local-only export/import, tool_slug, name, schema_version, config_json, visibility private/public, updated_at)`.

**workshop_projects** `(id, user_id, title, graph_json, metadata_json, schema_version, updated_at)` and **scene_projects** `(id, user_id, title, scene_json_key or JSONB when small, preview_key, schema_version, updated_at)` only when cloud save ships.

**download_events** `(id, asset_id, timestamp, coarse source, event idempotency key)` or privacy-conscious aggregated metrics; ensure easy opt-out.

**audit_log** `(id, actor_id, action, target_type, target_id, details_redacted, timestamp)`.

**upload_sessions** `(id, actor_id, expected_asset_id, staging_key, expected_type, expected_size, status, checksum, expires_at)`.

Indexes: GIN full-text title/descriptions/tags; unique slug; category/status/published; trigram or search fallback if justified; compound filters; foreign-key indexes. Build schema migrations and typed query layer. For RLS, everyone can read `published` and public files; only authorised admin/editor can create/publish/update; users can only read/write their own private presets/projects. Test RLS with actual unauthenticated and authenticated clients.

## 8. Catalogue and asset detail requirements

Catalogues support full-text search, URL-persisted filters (asset type, style, setting, file format, licence, commercial usability, category, texture resolution, triangle-count range, animation/rigged status, engine), sort by recent/popular/name, pagination or infinite scrolling, responsive grid/list toggle, useful no-results suggestions, and consistent canonical URLs. Filters that cannot be supported by trustworthy metadata must be hidden, not faked.

Asset cards: optimized thumbnail, title, category, tags, available formats, licence shorthand; optional triangle or texture size metadata. Detail pages: gallery, orbitable 3D viewer for GLB, wireframe toggle, bounding dimensions, materials and actual mesh statistics, texture close-up with nearest filtering, source/credit/licence, included files, dependencies, technical usage notes, version, related assets, downloadable specific files or pack. Download dialog clearly enumerates files and licence obligations. Show verified rig/animation attributes only when present.

Collections: owner-curated packs such as Industrial Facility, CRT & Electronics, Retro Street, Horror Interior, Weapons & Props, Architectural Modules. Bundle downloads should be generated asynchronously or prebuilt/cached; avoid ZIP-on-every-request. Each pack must include third-party licence notices for every included asset.

---

## 9. Browser tools — precise product requirements

Every tool has: drag/drop and file-picker upload, sample asset, live before/after preview, undo/reset, keyboard-accessible labelled settings, estimate of output dimensions/bytes, sensible memory limits, clear download action, optional copy/share recipe, non-destructive internal state, helpful errors and export tests. Tools should process locally unless explicitly stated. Persist **settings** locally; avoid silently persisting visitors' uploaded images. Capture no uploaded content in analytics. Prefer PNG for lossless pixel art, transparent alpha preservation and intentional resampling settings.

### T01 — Seamless Texture Generator (existing owner tool)
Integrate the owner's existing source **only after it is provided**. Preserve current algorithm and outputs via regression samples. If source is not available, build a well-marked compatible placeholder/initial implementation with offset/edge blending, feather width, heal/clone controls, tile preview (3×3), seamlessness score heuristic (clearly nonauthoritative), before/after comparison, export. Prioritise integration over redundant rebuild.

### T02 — Retro / PSX Texture Converter
Image upload; output resolution presets 32, 64, 128, 256, 512 and custom power-of-two/non-power-of-two; nearest and high-quality image sampling options; quantisation to configurable palette size; bit-depth/channel quantisation where technically correct; ordered Bayer, Floyd–Steinberg and optional blue-noise dithering; grain/noise optional; brightness/contrast/saturation, optional gamma, alpha preserve, palette locking; tileable preview; batch mode later; PNG export. Distinguish visual effects from authentic console pipelines; do not imply quantisation automatically enforces VRAM limits.

Acceptance: transparency preserved, dimensions exact, preview matches export, deterministic for fixed noise seed, outputs valid PNG, app responsive for sensible image caps.

### T03 — Texture Atlas Builder
Drag multiple tiles/images; rename, order and choose tile dimensions; optional individual rotate/crop/fill; atlas dimensions auto/manual, safe gutters/padding, extruded edges to avoid bleeding; grid packing initially, bin packing optionally; selectable square/power-of-two atlas output; nearest or configured resize; grid guides, zoom/pan; selection inspector; export atlas PNG and JSON mapping with normalized UVs, pixel rects, origin convention, rotated flag; export CSV optionally. Provide presets for Blender/Godot workflows, note UV origin differences and filtering pitfalls.

Acceptance: no overlapping atlas regions, deterministic packing, UV metadata corresponds to actual rendered pixel bounds, alpha/gutters tested, overflow handled clearly.

### T04 — Colour Palette Generator
Upload reference to extract dominant colours (median-cut/k-means or equivalent, compare in a perceptual colour space where practical); sizes 4/8/16/32/64/128/256; palette editor (add/remove/lock/rename/reorder), harmonies, editable hex/RGB; import/export GPL, ASE if implemented and verified, PNG swatch and JSON; apply palette to images with nearest-colour matching and optional dithering; built-in *inspired-by* palettes, no falsely asserted official hardware palettes; colour-blindness readability checker optional.

Acceptance: locking honours pinned colours, conversions deterministic, imported/exported palette roundtrip tested.

### T05 — Low-Poly Model Viewer and Inspector
GLB/GLTF upload (local GLTF with external dependencies via multi-file picker where supported), orbit/pan/zoom, camera reset, background, ground/grid, lights, wireframe, normal and unlit display, flat shading toggle with clarity that rendered normals may differ, polygon/triangle/vertex counters, meshes/materials/textures/animation list, texture resolution checks, axis-aligned dimensions, UV channel count when accessible, animation scrub/play for supported clips. No server upload by default. Detect unsupported file and compressed extensions gracefully. Revoke object URLs/dispose GPU resources upon change. Export screenshot; optional basic report JSON.

Acceptance: handles textured GLB, skinned animated sample and malformed input safely; stats label geometry triangles versus draw calls correctly where measurable; screenshot exports; no memory leak under repeated loads.

### T06 — Bitmap Font Generator
Upload legally licensed OTF/TTF (local only); user selects charset/Unicode ranges, size, antialiasing toggle, spacing, line-height, outline, drop shadow, threshold, glyph padding, color; draw atlas using browser font loading/canvas; export atlas PNG plus BMFont text/JSON and metadata for supported target engines, only claim import compatibility where tested. Display missing glyph warnings; multiple pages for huge charsets; 1-bit/pixel-art threshold optional.

Acceptance: glyph bounding boxes and advance metrics match preview; export roundtrip renderer test; special characters and spaces handled.

### T07 — Decal and Transparency Generator
Upload photo/texture; manual crop/rotate, threshold and keying by sampled colour with tolerance, feather/edge cleanup, alpha eraser and brush refine, optional simple luminosity masking; layer stencil preview against checker and 3D wall; tint/contrast/weather; save transparent PNG. Do not claim AI semantic background removal unless a real browser/server model is implemented and disclosed. Optional mask output. Provide preset sizes.

Acceptance: correct alpha, transparent outside subject, no black fringe on typical sample, pixel-correct export.

### Later individual utilities
- Batch texture resizer: folder upload, dimension presets, process list, ZIP download.
- Animated GIF/video frames → spritesheet (respect browser video decoding limits).
- Sprite sheet packer, metadata exporter and animation preview.
- UV test-grid/checker generator.
- Normal map from height image with proper gradient calculation; note not true photogrammetric normal reconstruction.
- Skybox equirectangular ↔ cubemap with seam-aware sampling.
- Billboard cutout generator; optional sprite impostor rendering from GLB using fixed camera angles.
- Retro audio bitcrusher: import WAV/MP3 where browser decodes, downsample/bit-depth reduction, playback level normalization, WAV export; avoid codec licensing assumptions.
- Scroll/blink/cycle texture animator and GIF/APNG or frame-sequence exports.
- PSX-look material/shader preview with visual approximation controls.
- Heightmap → low-poly terrain GLB generator.

---

## 10. Downloadable resource expansion — owner-curated workstream

Each category below is a **content-production/curation track**, not an instruction for Claude to conjure finished professional-quality game assets. First deliver catalogue support, metadata templates, sample formats, preview generation and checklists. The owner will add/approve actual content individually.

**A — Modular environments:** wall, floor, corner, ceiling, stair, door, window, corridor, trim, pipe, vent, railing; matching grid dimensions and pivots; collision recommendations; texture variants; coordinated modular packs. Example themes: industrial, urban, sci-fi, derelict, brutalist, domestic, horror.

**B — Decals:** graffiti, rust, grime, stains, water leaks, cracks, bullet impacts, damage, posters, labels, signage; alpha, orientation, intended blend mode and scaling.

**C — Skyboxes/backgrounds:** skies, distant cityscapes, mountains, industrial horizons, cloud layers, panoramic environments; mark projection type, HDR/LDR and usage rights.

**D — UI/HUD:** inventory tiles, dialogue borders, health meters, icons, cursors, menus, bitmap fonts, licensed icon packs, input hints, 9-slice assets.

**E — VFX:** muzzle flash, fire, dust, smoke, sparks, explosions, impact puffs, blood effects if appropriate, animation sequences, spritesheets; metadata for frame rate, alpha blend and pivots.

**F — Character starter kits:** rigged neutral characters, basic NPC/enemy archetypes, hands, weapon attachment conventions, idle/walk/shoot animations, compatibility notes, skeleton standards; animation ownership/licensing carefully tracked; no assumption Mixamo redistributed clips are allowed.

**G — Audio:** game-ready short SFX and ambient layers; metadata for sample rate/channels/duration, licence, loop points; curate links until licensed owned audio exists.

For every downloadable pack define: inclusion list, scale/units, pivot rules, triangle budgets as style targets not hard historical caps, texture sizes, material strategy, imports tested in Godot/Blender where feasible, licence/attribution, version history, preview and thumbnail requirements, documentation README.

---

## 11. Shaders, scripts, templates and starter projects

Create searchable resource registry and actual downloadable source bundles. Every entry includes engine/version tested, renderer, screenshot/video preview, code, licence, setup steps, limitations and changelog. Never label untested snippets production-ready.

**Godot initial catalogue:** PSX-inspired vertex snapping (explain model/camera-space implications); resolution scaling; ordered dithering/palette posterisation; distance fog; unlit/vertex-coloured materials; texture sampling presets; optional affine-style UV warp approximation (document limitations); billboard sprite material; low-poly water; CRT post-process; retro sky/fog; fixed-camera player controller; camera transitions; movement relative to camera; simple third-person/overhead character controller; aiming/shooting; animation tree wiring; simple environment demo.

**Blender:** retro material template, palette/texture atlas workflows, export GLB checklist and automated Blender add-on templates only when versions tested; low-poly scene setup and lighting presets; optional preprocessing scripts for generating texture derivatives and metadata; material baking guide/sample file.

**Unity:** URP-compatible equivalents if practical, with render-pipeline/version compatibility tracked separately. **Unreal:** metadata and carefully scoped templates later; do not overpromise parity.

**Starter project downloadable packs:**
1. Godot Retro Starter: project configured, one room, sample geometry, fixed-angle camera, character controller, sample greybox, retro settings, README and rights-safe samples.
2. Godot Fixed Camera Horror: interactable objects, simple door trigger, camera zones, character animations represented with own sample clips/placeholders.
3. Blender Retro Asset Preparation: scene and export checks, atlas-friendly material, normal/baked light illustration.
4. Unity Retro Renderer Demo: later, after Godot templates validated.

Ensure scripts and project files are reviewed for security, arbitrary code execution, engine compatibility and redistributable dependencies. Store source in version control; publish signed/reproducible release ZIPs with checksums; support GitHub links when public.

---

## 12. Learn — curated YouTubers rather than a huge authored article business

Curate excellent game-development YouTubers and high-value individual videos. Deliver creator directory cards, channel links, video cards, curated playlists, difficulty, engine, tags, last manually reviewed date, search/filter, featured picks, and short original descriptions of what viewers will learn. Use YouTube's permitted embed iframe API or link directly; no video downloading, mirroring or scraping. Avoid unapproved creator avatars or branding. Manage manually first through CMS; optional YouTube Data API enrichment later with quota discipline and refresh caching.

Recommended editorial taxonomy: Beginner Setup, Blender UV & Textures, Godot Rendering, Low-Poly Modelling, Character Rigging/Animations, Godot Gameplay, Optimisation, Retro Art History, Level Design, Technical Art, Shader Tutorials. Make transparent that channels/videos are third-party resources and link to their creators. Include submissions/suggestion form as a later feature and moderation before listing.

Minimal authored reference pages can cover essential tool instructions, platform licence policy, console-aesthetic distinctions, and export troubleshooting; don't duplicate creator tutorial libraries unnecessarily.

---

## 13. Retro Asset Workshop — processing pipeline

Purpose: combine tools into a reproducible non-destructive node-based or ordered-step editor. Initial support: image inputs and PNG/WEBP output; texture atlas integration; model input branches later if actual transformation nodes exist.

User flow: (1) drag/drop one or more images or select a published texture; (2) choose a preset or start blank; (3) append/reorder/disable processing steps; (4) preview original, intermediate and final states; (5) adjust parameters, (6) process current or queue batch, (7) export files and machine-readable manifest.

Initial nodes: input, crop, resize, seamless-tiling, adjust colour, alpha threshold, palette quantise, dither, edge/padding, output, atlas-pack (multi-input). Node state is JSON serialisable and versioned; execution runs in a typed dependency graph, validates cycles, caches intermediate nodes by hash, uses workers to avoid UI blocking, and exposes progress/cancel. If a visual graph editor proves costly, ship a robust reorderable step list first; the core processing graph should be reusable by both.

Presets: PSX-inspired Dirty Industrial, Pixelated Horror, N64-inspired Soft Palette, UI Sprite Cutout, Atlas 128 Grid and user-created custom. Presets contain operation types/settings only, not copyrighted samples. Support version migration, import/export JSON, localStorage/IndexedDB storage of recipes, with caution about quota and image content privacy. Logged-in users may sync recipes only via explicit opt-in.

Batch processor: drag in many images, select preset, review estimated memory/storage, concurrency limit, individual failures, ZIP download with deterministic filenames and `manifest.json` documenting source names, dimensions, pipeline/version, outputs and checksums where practical. If a single image fails, report it without discarding all successful outputs.

Acceptance: single-input recipe roundtrips, deterministic processing, intermediate previews consistent, abort works, batch ZIP valid, preset version upgrades tested, no hidden server upload.

---

## 14. Browser Scene Builder — scoped alpha and detailed later vision

**Alpha objectives:** a lightweight environment blockout tool and resource sampler, not a substitute for Godot/Blender. Load verified site GLB models and local user GLBs; instantiate into scene; edit transforms; paint with approved textures; save JSON/GLB; test in external engine.

UI: viewport central; left searchable asset palette (library and local upload); right transform/material inspector; scene hierarchy and layers; top editor toolbar; status bar with triangles/objects; project file controls. Desktop-first with graceful mobile unsupported/editor limited notice rather than unusable cramped UI.

Core functions:
- Orbit/free-fly/top/orthographic camera, focus selection, grid, floor and axis gizmo; camera controls with documented shortcuts.
- Drag library prop to viewport with raycast grid placement and sensible pivot; object selection, add/delete, duplicate, multiselect where practical.
- Translate, rotate, scale (gizmos), numeric transforms, snap grid/angle, duplicate, copy/paste; undo/redo command stack.
- Hierarchy groups, rename, hide/show, lock, parent/unparent; collision-free unique IDs; autosave local scene JSON with recovery and explicit save.
- Place primitive cubes/planes/cylinders for blockout; assign library textures; adjust UV repeat/offset and material tint.
- Directional/ambient lights, simple fog and background colour, optional shadow toggle with performance warning; presets for moody industrial or neutral studio lighting.
- Retro-style preview (low internal resolution, nearest upscale, fog, dither, palette effects, optional vertex jitter) implemented as toggleable approximations. Provide direct comparison with clean viewport. Limit triangles/textures to keep editor responsive.
- Export to GLB using standard glTF exporter, and accompanying scene JSON for tool-specific metadata. Include all dependencies or manifest, verify reimport with glTF loader, and warn about non-exportable shaders/effects, colliders, scripts and application-specific features.
- Support imports of local GLB/GLTF with bundled dependencies; unsupported FBX/BLEND/OBJ preview/convert requests should offer original download and clear format guidance, not silently fail.

**Later features (not required for alpha):** grid-aligned modular construction, vertex paint, basic decal planes, environment brush/stamping, prefabs, scene templates, material atlas UV chooser, object collision proxy generation, export helper for Godot scene generation if robustly tested, project cloud sync, sharing read-only previews, image capture and turntable video, lighting/lightmap export with clear engine constraints.

Important architectural details: scene graph identified by stable UUIDs, versioned `.retro-scene.json` schema, asset dependency manifest, progressive loading/LOD, thumbnail memory policy, 3D texture/object disposal, undo/redo boundaries, load protections for untrusted GLB extensions, offline editing where possible. Handle missing hosted assets gracefully with placeholders and remediation. Never assert exported GLB contains custom realtime shaders or gameplay behaviour.

Acceptance: place 10 provided test GLBs; move/rotate/scale, delete and undo, save/reload JSON with identical transforms, export GLB and import into Blender/Godot preserving meshes/materials/transforms to the limits of glTF; no crashes with bad file; project survives refresh via explicit save/local recovery; performance assessed with stress scene.

---

## 15. Administration/CMS

Provide genuine owner-only admin, no demo-access routes on production. Dashboard for assets count, unpublished backlog, licence completeness, broken thumbnails, downloads, storage usage and recent edits. Forms to create/edit assets, upload sources, assign categories/tags, asset variants, licences and attribution, manage previews, curate collections, mark featured, set published/draft. Bulk edit metadata and import manifest. Manage curated YouTubers, videos, shaders, starters, tool availability and homepage sections. Use soft-delete, audit logging and safe backups. Validate published file existence and all required metadata before publishing.

Role model: owner/admin (full management), editor (curation/drafts, with controlled publish), visitor (read), optional registered user (personal private presets/projects). Protected upload signing endpoint independently checks role and intended staging path. No unrestricted browser CORS to private buckets.

## 16. SEO, discoverability and accessibility

Server-rendered catalogue pages; metadata, canonical links, sitemap, robots, OpenGraph previews, JSON-LD when applicable and truthful, title/description templates, breadcrumbs; descriptive slugs and 301 redirects on renames; image alt text and responsive thumbnails. Respect pages with thin generated combinations to avoid index bloat. No ads/popups or fake urgency.

WCAG 2.2 AA as target: all tools usable with keyboard wherever possible (visual 3D manipulations have numeric transform equivalents), form labels, focus management, logical headings, captions for video links, contrast and reduced motion. Use screen-reader status messages for processing progress/errors and provide nonvisual model metadata.

## 17. Privacy, legal, provenance and download policy

Before opening any asset publicly, owner must confirm ownership or adequate redistribution licence. Keep source licence URL and attribution text; make notices included in downloadable ZIPs. Do not rehost another creator's commercial assets or YouTube media because they are publicly viewable. For free third-party resources, link to original download page when redistribution isn't explicitly allowed. Clarify visitor uploads used by tools remain local unless cloud save is explicitly enabled. Provide privacy, cookie/analytics disclosures and contact/takedown process. Sanitize assets and do not promise perfect malware screening.

Custom licence is never 'CC0 by default'. Different files in a bundled pack may require distinct notices; permit only combinations with compatible redistribution terms. Keep review flags for ambiguous content. Allow takedown/unpublish and audit trail.

## 18. Quality and acceptance gates

Baseline CI: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, integration DB/schema tests, Playwright E2E tests against a seeded environment. Document supported Node version, package manager, exact lockfile and reproduction steps. Use Vitest for processing algorithms; property or golden-file tests for atlas coordinates, alpha export, palette quantisation and preset versioning. Test tools with opaque and transparent images, dimensions 1x1/odd/power-of-two, excessively huge inputs, invalid MIME, corrupt file, Unicode filename, repeated uploads and cancellation.

E2E journeys:
1. Browse assets anonymously → filter → detail → preview → download verified ZIP.
2. Owner login → stage sample GLB + preview → enter licence → publish → public searchable listing.
3. Import bulk manifest with intentional bad row → dry-run identifies error → corrected import succeeds without duplicates.
4. Upload texture → seamless → converter → download PNG matching preview.
5. Upload 4 tiles → atlas → export PNG/JSON → validation checker verifies UV boxes.
6. Upload rigged GLB → inspect animations and triangles → unload/reload without leaking resources.
7. Generate bitmap font → export → render sample output from exported metadata.
8. Create workshop pipeline → export/import preset → batch outputs and manifest verified.
9. Scene editor create → place asset → transform → undo/redo → save/reload → GLB export/reimport.
10. Unauthenticated attempt to publish or sign arbitrary storage paths gets 401/403 and leaves no published object.

Performance gates: public catalogue interactive without loading 3D libs; lazy load model viewers and image editors; compressed optimized thumbnails; sensible Core Web Vitals targets; dashboard images do not download full ZIPs. Monitor webworker CPU/memory and device loss fallback. Accessibility automated audits and manual keyboard smoke tests.

## 19. Codebase layout (suggested)

```
apps/web/
  app/                    # Next.js routes, layouts, server endpoints
  components/             # site, cards, forms, viewers, tool controls
  features/catalog/
  features/admin/
  features/toolbox/
  features/workshop/
  features/scene-builder/
  lib/auth/
  lib/db/
  lib/storage/
  lib/search/
  lib/validation/
packages/processing-core/  # canvas-independent transformations where possible
packages/file-formats/     # validators, manifests, fonts, atlas exports
packages/scene-schema/     # serialisable versioned editor project schema
packages/ui/               # shared styled components
supabase/migrations/
scripts/                    # seed, ingest, validate manifests, preview pipeline
public/demo/               # small rights-safe example sources only
content/                   # curated editorial data where CMS not necessary
tests/e2e/
docs/
  architecture.md
  DEPLOYMENT.md
  ASSET_IMPORT_GUIDE.md
  RIGHTS_AND_LICENSING.md
  IMPLEMENTATION_STATUS.md
  decisions/
.env.example
README.md
```

Avoid overengineering a monorepo if one app is sufficient initially; it is acceptable to simplify to `src/` as long as modules and tests stay clean. Reusable processing core is particularly important so individual tools and Workshop share algorithms, not forked implementations.

## 20. Detailed milestones for Claude

**M00 Discovery and setup:** inspect existing repo; locate any existing seamless tool; detect framework and package manager; establish decisions and blockers; define design tokens; create baseline app, tests, CI and documentation. If repo empty, scaffold Next.js TypeScript.

**M01 Public shell/design:** layout, navigation, home, responsive components, theme, directory placeholder pages, empty/loading/error states, SEO base. Check responsive breakpoints and keyboard navigation.

**M02 Infrastructure:** Supabase migrations/RLS, server data layer, R2 adapter and local dev storage, secure owner login, `.env.example`, staging/signing upload API, object verification, deployment runbook. No production secrets committed.

**M03 Asset CMS + catalogue:** admin create/edit/upload/publish, sample data, search/filters, asset pages, thumbnails, GLB preview, downloads, collections, licence gating, bulk ingest dry-run/import, audit log. Launchable first-value milestone.

**M04 Initial processing tools:** integrate owner seamless tool if present; converter/resizer; image format validation; progress handling; regression tests and downloads.

**M05 Advanced tools:** palette, texture atlas, model inspector, bitmap font, decal; each with its own unit/E2E tests and examples. Avoid shipping all as incomplete stubs.

**M06 Resources and curated video directory:** shader/project CMS and public pages, downloadable Godot sample(s) only where verified; creator/video records and embeds; external resource links and provenance.

**M07 Workshop:** shared processing pipeline, versioned presets, local project storage, batch processing, ZIP manifests; optimize large-image operation.

**M08 Scene editor alpha:** viewport, asset placements, transform controls, hierarchy, materials, lights/fog, save/load, GLB export; multi-sample compatibility test; editor performance and crash hardening.

**M09 Stabilisation and deploy:** security review, licences audit, cross-browser QA, automated backups, CDN headers, analytics, storage budget alarms, content import rehearsal, release checklist.

**M10 Postlaunch backlog:** remaining audio, skybox, sprite and shader utilities, advanced scene features, curated community submissions, collaborative features only if real demand.

For each milestone produce evidence: functioning URLs/routes, completed implementation checklist, automated test results, remaining issues. If external setup missing, substitute a local test adapter and document exact manual owner actions. Prioritise a usable vertical slice over simultaneous broken implementations.

## 21. What the owner must supply or approve

1. Brand name and domain (can remain placeholders to start).
2. Existing seamless texture generator source or a location in the repository (if available).
3. Asset/model/texture collection, or a small sample pack to calibrate previews and ingestion; do not require full collection for first development pass.
4. Rights and redistribution permission for every asset; any third-party downloads whose licence is unclear must stay external links or drafts.
5. Cloudflare account and R2 bucket credentials, Supabase project and keys, deployment account and domain DNS later; developers should not ask for credentials pasted into chat, use environment/secrets management.
6. Design reference/brand identity, preferred site title and choice of licence for original assets.
7. Content approval for shader/starter project quality and featured creator directory.

Build-time defaults where unspecified: all assets free-to-download but licence displayed and never assumed; anonymous access to public tools; private-by-default admin uploads; desktop-first creative workspaces; modern game engines with Godot first, Blender close second, Unity next, Unreal later.

## 22. Immediate first assignment (paste into Claude to start implementation)

> Read `RETRO_DEV_MASTER_BUILD_PLAN.md` completely and treat it as the specification. Inspect the repository before changing anything. Implement M00, M01, M02 and the vertical slice of M03 first: polished responsive shell; database schema/RLS; secure admin asset creation; local/R2 file abstraction; one published 3D asset and one texture seeded legally as demo content; searchable public catalogue; GLB viewer and real file download; tests, docs and `.env.example`. If cloud service credentials are missing, use local development adapters and make setup steps explicit. If an existing seamless texture tool is present, identify its integration points without breaking it. Document architecture and all deferred scope, then continue milestone by milestone. Don't claim later features are complete until their functionality and tests prove it. Do not request my whole asset library to begin.

---

## 23. Definition of complete project

A new visitor can find a properly licensed low-poly model or texture, inspect it, understand its specs, download the actual files, upload their own texture to make it seamless, convert its colour/depth/size, build an atlas, inspect an animated GLB, generate a bitmap font and decal, discover a quality curated tutorial and tested engine sample, save a repeatable image-processing preset, and create an exportable small 3D environment in the browser. The owner can import and manage a large catalogue without editing source code and without leaking private credentials. Every advertised action works; unsupported advanced conversions are openly labelled. The site is secure, backed up, performant, maintainable and documented.

## 24. Reference documentation / verification notes

- Cloudflare R2 pricing: https://developers.cloudflare.com/r2/pricing/
- Cloudflare R2 presigned URLs: https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Cloudflare R2 uploads: https://developers.cloudflare.com/r2/objects/upload-objects/
- Supabase storage pricing for alternatives: https://supabase.com/docs/guides/storage/pricing
- three.js GLTFLoader: https://threejs.org/docs/pages/GLTFLoader
- three.js GLTFExporter: https://threejs.org/docs/pages/GLTFExporter.html
- Godot accepted scene formats: https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/importing_3d_scenes/available_formats.html
- Godot scene export caveats: https://docs.godotengine.org/en/stable/tutorials/assets_pipeline/exporting_3d_scenes.html
- YouTube embed API: https://developers.google.com/youtube/iframe_api_reference

Pricing and vendor capabilities can change; implementation must recheck documentation at integration time.
