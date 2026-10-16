# LOWPO11Y design system

Direction: a late-80s/90s game-development workstation. Warm graphite surfaces,
bone-white type, one restrained sodium-amber accent. Real imagery (textures,
model thumbnails) carries the visual interest; the chrome stays quiet.

## Colour tokens

Defined once in `src/app/globals.css` and exposed to Tailwind as `bg-*`,
`text-*`, `border-*` utilities. Never hard-code hex values in components.

| Token | Dark | Light | Use |
|---|---|---|---|
| `bg` | `#1b1a18` graphite | `#e3dfd5` beige hardware | Page background |
| `sunken` | `#141311` | `#d6d1c5` | Tool canvases, wells, code blocks |
| `panel` / `panel-2` | `#23221e` / `#2b2925` | `#ebe7de` / `#f2efe8` | Surfaces / raised + hover |
| `rule` / `rule-strong` | `#393731` / `#4f4b43` | `#c3bdb0` / `#a39d90` | Borders, dividers |
| `fg` | `#e8e3d6` bone | `#1f1e1b` | Primary text |
| `muted` | `#a29c8f` ash (6.4:1) | `#57534b` (5.7:1) | Secondary text |
| `faint` | `#7a7469` | `#6f6a60` | Disabled, decorative only — never body copy |
| `accent` | `#e2a03c` sodium (7.7:1) | `#8a4f05` (4.9:1) | Focus, active state, primary action |
| `danger` | `#e0644a` tally | `#a8321d` | Errors, destructive actions only |
| `ok` | `#8fb573` | `#3f6b2a` | Success states |
| `info` | `#7fb2ac` phosphor | `#2f6b66` | Measured technical data, wireframes |

Contrast ratios are against `bg`. Accent text on accent fill uses `accent-ink`.

## Type

One family, Archivo, using its width axis:

| Utility | Size / line | Width | Weight | Use |
|---|---|---|---|---|
| `type-display-xl` | 40–72px / 0.98 | 125% | 800 | Home hero only |
| `type-display` | 32–48px / 1.03 | 122% | 760 | Page titles |
| `type-title` | 24 / 1.18 | 116% | 700 | Section titles |
| `type-heading` | 21 / 1.24 | 110% | 650 | Panel and card group headings |
| `type-subheading` | 18 / 1.35 | 104% | 600 | Sub-sections |
| body | 16 / 1.55 | 100% | 400 | Prose, max ~70ch |
| `type-label` | 14 / 1.3 | 100% | 560 | Controls, form labels |
| `type-small` | 13 / 1.4 | 100% | 400 | Help text, captions |
| `type-data` | 12 Martian Mono | 88% | — | Hex values, px sizes, triangle counts, code |

Rules: sentence case everywhere; no all-caps eyebrow labels; no middle-dot meta
strings (use a spec list instead); no arrows appended to link text.

## Shape and structure

- Radii scale with hierarchy: `xs` 2px chips, `sm` 3px controls, `md` 4px
  panels and cards, `lg` 6px dialogs.
- No drop-shadow kits. Elevation is a lighter surface (`panel-2`) plus a rule.
- Ruler ticks and grids appear only where they carry information (tool
  canvases show real pixel coordinates, viewers show real dimensions).
- Images with alpha always sit on `bg-checker`. Pixel textures use `pixelated`.
- The one bold element on the site is the home hero's texture page; the faint
  scanline layer appears only there.

## Motion

Only in response to user action (open, expand, confirm), 120–180ms, and
disabled under `prefers-reduced-motion`. No entrance animations on scroll.

## Components

`src/components/ui/` holds the primitives: Button, IconButton, Field, Input,
Textarea, Select, Checkbox, Switch, Slider, NumberField (drag-to-scrub, arrow
keys), ColorField, Badge (file type, licence), Chip, Dialog, DropdownMenu,
Tabs, Tooltip, Toast, Progress, EmptyState, ErrorState, Skeleton, Pagination,
Table, Dropzone, Kbd, Breadcrumbs, Panel (collapsible inspector).
