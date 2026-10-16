# 0006 — UI stack: Radix primitives, Tailwind tokens, self-hosted fonts, vanilla three.js

**Decision.**
- **Radix UI** (`radix-ui`) for accessible behaviour (dialog, dropdown, tabs,
  tooltip, slider, popover, toggle group). It is headless, actively maintained
  and handles focus trapping, ESC and ARIA. All styling is ours.
- **Tailwind CSS v4** with design tokens declared once as CSS variables in
  `src/app/globals.css`. See `docs/DESIGN_SYSTEM.md`.
- **Fonts self-hosted** with Fontsource — no build-time network fetches and no
  third-party font requests at runtime. (Faces: see ADR 0007.)
- **three.js without React Three Fiber.** The model viewer, inspector and scene
  editor manage renderer lifetime, disposal and object URLs explicitly in
  imperative modules behind thin React wrappers. Editor state (scene graph,
  command stack) lives outside the renderer so it is testable in Node. three.js
  is only loaded through dynamic imports, never on catalogue list pages.
- **Icons:** `lucide-react` (tree-shaken).
