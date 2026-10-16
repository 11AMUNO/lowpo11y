# 11AM-Seamless v2

Turns textures into seamless tiles, PSX-style assets and transparent cut-outs, in batches. Everything runs in your browser and nothing is uploaded.

## Run it
Double-click `index.html`. No install or server is needed. (The fonts load from Google Fonts when you're online. Offline, it falls back to your system monospace.)

## Library and collections
- Drop folders onto the page, or use `+ FOLDER`. **Each folder becomes a collection.** Files go into the collection named after the folder they sit in, so dropping `Textures/` that contains `01 - Wood grain/` and `02 - Floor tiles/` gives you two collections.
- `+ FILES` or loose files go into `UNSORTED`.
- Collections are listed in order (01, 02, 03 …) with a break between each. Click a header to collapse it. `✎` renames it (the name is also its export folder). `×` removes it.
- `✎` next to a file means its settings differ from the defaults.

## Editing
Every file has its own settings. Pick a file, tune it, then use **COPY THESE SETTINGS TO**:
- `COLLECTION` copies them to every file in that file's collection only.
- `EVERYTHING` copies them to the whole library.

The app asks before it overwrites files you've already customised. `RESET` puts the file back to the defaults.

## Pipeline (runs top to bottom)
| Step | What it does |
|---|---|
| **01 SOURCE** | Long side (ORIG/128/256/512/1K/2K), smooth or nearest resampling, square crop, flatten light (removes big lighting gradients) |
| **02 SEAMLESS** `ON/OFF` | BLEND (offset + heal), MIRROR (kaleidoscope), EDGE (heals the borders only), OFFSET (wrap only). Controls: Blend width, Blend strength, Organic seam. ADVANCED adds seam position, falloff, pixel-safe blend and mirror fit. Turn it OFF to use only the other steps |
| **03 BACKGROUND** `ON/OFF` | Turns pure black transparent. CONNECTED TO EDGE ONLY keeps dark detail inside the object. Threshold sets how dark counts as black, and Soft edge keeps outlines anti-aliased |
| **04 PSX EFFECTS** `ON/OFF` | Limit colours (2–256 adaptive palette), 15-bit RGB555, dither (4×4 like the PS1, 8×8, or Floyd-Steinberg) and dither strength. With Background on, transparency is a hard 1-bit cut and the palette comes from the object only |

A step that's OFF folds down to its header. The header always shows a summary of its settings.

## Export
- **FORMAT**: PNG, JPG or WEBP. JPG can't store transparency.
- **THIS FILE**: rename it and `[ DOWNLOAD ]`, or `[ 3×3 SAMPLE ]` for a tiled preview image.
- **BATCH**: SCOPE is the current collection or everything. Tick any of SIZES 1024 / 512 / 256 / 128. The zip is laid out as `SIZE / COLLECTION / file`, e.g. `1024/01 - Wood grain/Honey Oak.png`, and the box above the button previews the layout. If no size is ticked, it exports `COLLECTION / file` at each file's own SOURCE size. Each size is rendered fresh from the original.
- **BATCH RENAME** works within the current scope. Tokens: `{name}`, `{n}` (01, 02 … per collection), `{collection}`, `{mode}`.

The readout under the viewport shows a SEAM score. Around 1.00× means the repeat is invisible.

## Keys
`↑` `↓` select file · `D` download · `T` toggle tile/split · `Del` remove

## Files
`index.html` page · `style.css` look (palette and CRT treatment from BH-PromptEngine) · `engine.js` image processing · `app.js` UI · `zip.js` zip export
