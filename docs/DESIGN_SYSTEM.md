# LOWPO11Y design system

The visual identity follows the owner's **11AM-Seamless** tool (palette, type
and CRT treatment from BH-PromptEngine): a monochrome terminal on void black.
Brightness and glow carry hierarchy instead of hue. Real imagery — textures and
model thumbnails — is the only colour on the page. See ADR 0007.

## Tokens

Declared once in `src/app/globals.css` and exposed to Tailwind (`bg-*`,
`text-*`, `border-*`). Components never hard-code colours.

| Token | Value | Seamless name | Use |
|---|---|---|---|
| `bg` | `#000000` | `--bg-void` | Page background |
| `panel` | `#070707` | `--bg-panel` | Panels |
| `sunken` | `#030303` | `--bg-code` | Inputs, wells, canvases, module bodies |
| `hover` | `#0d0d0d` | (row hover) | Hovered and active rows |
| `rule` / `rule-strong` | `#1f1f1f` / `#2c2c2c` | `--line` / `--line-2` | Dividers / panel borders; dashed for internal separators |
| `edge` | `#4a4a4a` | `--text-dim` | Button borders |
| `edge-strong` | `#6b6b6b` | — | Input and checkbox borders (raised from dim to meet 3:1 non-text contrast) |
| `fg` | `#f2f2f2` | `--text-primary` | Body text |
| `bright` | `#ffffff` | `--text-bright` | Titles, values, active state — usually with `glow` |
| `muted` | `#8e8e8e` (6.4:1) | `--text-muted` | Labels, secondary text |
| `faint` | `#4a4a4a` | `--text-dim` | **Decorative only**, e.g. step numerals and ASCII bar tails, always `aria-hidden` |

`--crt-glow` / `--crt-glow-soft` are the white text/box glows. Body text has
the soft glow; bright elements use `glow` (bright + strong glow).

## Type

- **Share Tech Mono** (`font-ocr`): titles, labels, buttons, tags, readouts and
  telemetry, uppercase with 0.05–0.14em tracking.
- **IBM Plex Mono** (`font-mono`, default): body copy, descriptions, inputs.

| Utility | Face | Size | Use |
|---|---|---|---|
| `type-display` | OCR, caps, glow | 28–40px | Page titles |
| `type-title` | OCR, caps, glow | 18px | Prose section titles (prefixed `//`) |
| `type-heading` | OCR, caps | 15px | Sub-sections |
| `type-panel` | OCR, caps, 0.14em, muted | 12px | `// PANEL` titles |
| `type-label` | OCR, caps, 0.1em, muted | 12px | Field labels |
| `type-data` | OCR, tabular | 12px | Numbers, sizes, hex values |
| body | Plex Mono | 14px / 1.55 | UI text; prose 15px / 1.7, max ~74ch |

## Vocabulary

- `// TITLE` panel headings; ` // ` separates fields in one-line summaries.
- `> ` prefixes telemetry, prompts and empty states; a blinking block cursor
  ends telemetry lines (static under reduced motion).
- `[ ACTION ]` brackets mark the primary action. Secondary buttons are plain
  bordered caps.
- `!` prefixes errors and warnings (white frame, no colour).
- ASCII bars `████░░░░` for slider levels and progress.
- `▾`/`▸` for expanded/collapsed modules; numbered pipeline modules `01 SOURCE`
  with an `ON/OFF` switch.

## Shape and structure

- Square corners everywhere (all radius tokens are 0).
- Panels: 1px `rule-strong` border on `panel`, ~14px padding.
- Pressed/selected: white border, bright text, glow (via `aria-pressed`).
- Images with alpha sit on the dark checker (`bg-checker`); pixel textures use
  `pixelated`.

## CRT layer

A fixed vignette and 3px scanlines with a slow 6s flicker overlay every page,
as in Seamless. The header/menu **CRT** switch turns the overlay and all glows
off (`html[data-crt="off"]`), stored in `localStorage` (`lp-crt`) and applied
before first paint. The flicker and cursor blink stop under
`prefers-reduced-motion`.

## Components

`src/components/ui/`: Button (`primary` = hot/bracketed, `secondary`,
`ghost`, `danger`, `link`), IconButton, OnOff, Field (stacked or inline),
Input, PromptInput, Textarea, Select, Checkbox, Toggle, Switch, SliderField
(ASCII bar header), SegmentedControl (joined, `aria-pressed`), NumberField
(drag-to-scrub), ColorField, Badge/FormatBadge, Dialog, Menu, Tabs, Tooltip,
Toast (bottom-centre, `> MESSAGE`), Progress (ASCII), Spinner, Skeleton,
EmptyState, ErrorState, Notice, Pagination, Table, Dropzone, Kbd,
Breadcrumbs, Panel, Module, Advanced.

## Accessibility contract

- Informative text is at least `muted` (6.4:1). `faint` text must be
  `aria-hidden` and decorative; the axe audit excludes `aria-hidden` nodes on
  that basis.
- Focus: 1px white outline, 2px offset, plus glow.
- Keyboard: all controls are native buttons/inputs or Radix primitives.
