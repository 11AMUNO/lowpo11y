# 0011 — Scene Builder: an immutable scene document mirrored into vanilla three.js

**Context.** The plan's alpha (section 14) asks for a browser blockout tool:
place verified library GLBs and local GLBs, transform them with gizmos and
numbers, snap, a hierarchy with groups, hide, lock and parenting, blockout
primitives with library textures, lights, fog and a retro preview with a
clean comparison, autosave with recovery, a versioned `.retro-scene.json`
with an asset manifest, and GLB export that is checked by re-importing. It
must handle missing hosted assets with placeholders and remediation, refuse
untrusted glTF extensions, dispose of GPU resources, and keep undo
boundaries clear. ADR 0006 already chose vanilla three.js over React Three
Fiber for the model viewer.

**Decision.**
- **The document is the truth; three.js follows it.** `src/lib/scene/schema.ts`
  defines the file (`{format: "lowpo11y-scene", version: 1, name, settings,
  assets, nodes}`): nodes have stable UUIDs, a parent id (array order is
  sibling order), a transform in metres and degrees (XYZ Euler), and either
  an asset reference, a primitive with a material, or nothing (a group).
  Loading validates everything with zod, repairs what it safely can
  (duplicate ids, missing parents, parent loops, references to assets that
  aren't in the manifest) and says what it changed; newer versions are
  refused, older ones go through a migration hook. Saving goes through the
  same schemas, so a scene always saves to the same bytes.
- **Edits are pure functions** (`src/lib/scene/editor.ts`) that return a new
  document: add, remove (with children), duplicate (with children and
  unique names), reparent, group and ungroup (all keeping world transforms,
  using three's math classes only), reorder, copy/paste as world-space
  copies, snapping. **Undo/redo is a stack of snapshots** (200 steps), each
  with a label ("Move Wooden crate"); a slider drag or a number scrub is one
  step (edits sharing a merge key within 1.2 s replace each other).
- **The runtime** (`src/features/scene-builder/runtime.ts`, loaded with a
  dynamic import so three.js stays out of the page bundle) keeps one Group
  per node and re-syncs from the document after every change. Models are
  loaded once per asset and cloned per instance (reference counted); the
  template is freed when the document no longer lists the asset. Primitives
  own their geometry and material. Missing or failed assets show a wire box
  and the reason; adding the missing local file again relinks it by SHA-256.
  TransformControls (with the grid's move/rotate/scale snaps), OrbitControls,
  orthographic top/front/side views, arrow-key fly, a ViewHelper and
  raycast picking. The gizmo reports live transforms for the inspector and
  commits one undo step when the drag ends.
- **Retro preview** is a viewport effect only: the scene renders to a
  low-resolution target (nearest filtering), then a post pass quantises
  colour levels with ordered dithering; a shared `onBeforeCompile` patch
  snaps vertices to a coarse screen grid. A split view shows clean and
  retro halves side by side. Editor overlays (gizmo, grid, selection boxes)
  are drawn at full resolution afterwards.
- **Assets.** Library models are published model assets with a published
  GLB delivery file whose licence allows downloads (`/api/scene/library`),
  fetched through the normal counted download route. Library textures reuse
  the Workshop's query. Local files are checked first (format guidance for
  FBX, OBJ, .blend and others; 64 MB; no external `.gltf` references; no
  Draco, meshopt or KTX2; 2 million triangles per model, warning above
  150,000; images up to 4096×4096), kept in memory and in IndexedDB keyed by
  SHA-256, and listed in the scene's manifest by name, size and checksum.
- **Persistence.** The scene autosaves to localStorage 0.7 s after each
  edit; on the next visit a banner offers to restore it (never automatically,
  so a scene that crashed the tab can't crash it again). Explicit Save
  downloads the `.retro-scene.json`. New and Open are undoable.
- **Export** uses GLTFExporter (binary, TRS, optionally hidden objects and
  the sun as `KHR_lights_punctual`), leaves out placeholders, then loads the
  file back with GLTFLoader and compares mesh counts. It always lists what
  glTF can't carry (retro preview, fog, ambient light, shadows, editor
  states). E2E runs every exported GLB through the Khronos glTF validator.
- **Small screens** get a notice first with "Open anyway"; the layout then
  stacks without sideways scrolling.

**Consequences.**
- The scene document is plain data, so files, autosave, undo and tests
  don't depend on three.js rendering; unit tests cover the editor without a
  GPU, and E2E proves save → open → save is byte-identical.
- Snapshots make undo trivial and memory-bounded by the 200-step limit;
  documents share unchanged nodes between snapshots.
- Every model instance is its own draw call (1,000 objects ≈ 1,400 calls).
  Instancing repeated models is the obvious next optimisation; it isn't
  needed for alpha-sized blockouts.
- Blender and Godot imports weren't run in this environment; the Khronos
  validator (which both importers follow) reports no errors or warnings.
  An owner check in both engines is listed as outstanding.
- No cloud save: the site has no visitor accounts, so `scene_projects` stays
  unbuilt as the plan allows.
