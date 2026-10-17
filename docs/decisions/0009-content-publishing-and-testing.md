# 0009 — Content publishing rules live in the database; "tested" means someone ran it

**Context.** M06 adds shaders, starter projects, a curated video directory
and external resource links. The plan says entries must record the engine
version, renderer, setup steps and limitations, that untested snippets must
never be presented as production-ready, that videos link to their creators
(no rehosting, no unapproved branding), and that third-party resources link
to the original site when redistribution isn't explicitly allowed. This
build environment can't reach Godot, YouTube or the resource websites.

**Decision.**
- **Rules in the database.** Migration 006 adds triggers that refuse to
  publish a shader without a known licence, a test date, code (or a file),
  an explanation, setup steps and limitations; a starter project without a
  licence, a test date, a verified ZIP and a description; a creator approval
  without a description, a link and a review date; a video without a video
  or link, a summary, a review date and an approved creator; a resource
  without an https link, a description and a review date. Unapproving or
  deleting a creator unpublishes their videos. The admin shows the same rules
  as a live checklist (`src/lib/content/checklist.ts`); the triggers are the
  authority.
- **Editors draft, admins publish**, for every content kind (row-level
  security, the same as assets).
- **Live previews for three.js shaders.** An entry whose GLSL file is split
  by `// --- vertex ---` and `// --- fragment ---` lines is compiled in the
  visitor's browser on a small scene; `uniform float x; // @control a..b = v
  "Label"` adds a slider. The admin can compile unsaved code the same way,
  so a three.js shader can be tested before it's published. Compile errors
  are shown, not hidden.
- **What we ship as tested.** Only the three.js PSX material, which the E2E
  suite compiles and renders in Chromium on every run, is published by the
  local demo seed. The Godot shaders are drafts until someone runs them in
  Godot and records the version and date. No starter project is shipped:
  none has been opened in an engine yet.
- **Learn.** Videos play from youtube-nocookie.com only after the visitor
  presses play; nothing is requested from YouTube before that (no iframe, no
  thumbnail). Creator descriptions are ours; avatars and channel art are not
  shown. No creators or videos are seeded: they need a person to watch and
  review them.
- **Resources.** Eleven well-known links are added as drafts with licence
  notes marked "written from memory" in their review notes; each needs its
  link and licence checked before it can be published.
- **Production seed.** `pnpm db:seed-content` adds the same shaders and links
  to any database (including production) as drafts, never publishing and
  never overwriting.

**Consequences.**
- Nothing incomplete or unverified can reach the public site through the
  admin, the API or a direct SQL update.
- The public Learn and Starter projects pages start empty in production until
  the owner reviews content. Their empty states say why.
- Shader downloads are rebuilt from the stored code when (re)published, so a
  ZIP always matches the page; starter ZIPs are copied, byte for byte, from
  the verified private upload.
