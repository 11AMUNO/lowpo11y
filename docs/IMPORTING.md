# Adding your models and textures

There are three ways to get files into the library. All of them create
**drafts**: nothing becomes public until you set a licence, confirm the rights
and press Publish on each asset.

| You have… | Use |
|---|---|
| One or two assets | **Admin → Assets → New asset**, then drop the files on the editor |
| A folder of assets (up to a few hundred files) | **Admin → Import** in your browser |
| A very large library, or you prefer a terminal | `pnpm import:assets` on your computer |

Every route uses the same checks: each file is identified by its content (not
its extension), executables are refused, FBX models are converted to GLB with
their textures, and every asset gets a thumbnail plus 32–256 px texture
variants where it makes sense. Files that are already in the library (same
SHA-256 checksum) are skipped, so running an import twice is safe.

## How folders are turned into assets

- **A folder with one model in it becomes one asset**, together with
  everything inside that folder. This matches exports like Tripo's:

  ```
  03/BH-03-Barrier/tripo_convert_3a02….fbx
  03/BH-03-Barrier/tripo_convert_3a02….fbm/tripo_image_3a02…_0_0.jpg
  ```

  becomes the draft **"BH-03 Barrier"** (slug `bh-03-barrier`, tag `bh-03`)
  with the FBX, its texture, a generated GLB and a thumbnail.
- **Several models in one folder** become one asset each; images that start
  with the model's name (`crate.fbx` + `crate_diffuse.png`) go with it.
- **Loose images** become one texture each:
  `wood/01 - Walnut Cupboard Light Wear.png` → **"Walnut Cupboard Light Wear"**.
- Files named `*thumb*`, `*cover*` or `*preview*` are used as thumbnails;
  `.blend`, `.psd` and similar project files are kept private as sources.
- `.DS_Store`, `__MACOSX` and other system files are ignored.

You can rename anything afterwards in the asset editor.

## Importing in the browser

1. Sign in and open **Admin → Import**.
2. **Choose folder** (or Choose files).
3. Optionally set defaults for every asset: category, provenance, notes, tags.
   Only set a licence here if it genuinely covers every file.
4. **Plan import.** This is a dry run: you see each asset, its files, and
   anything that would block it. Nothing has been created yet.
5. **Import N drafts.** Each asset is created, its files are uploaded straight
   to storage and checked, and previews are generated. Keep the tab open
   until it finishes.
6. **Review drafts** takes you to the list. For each one: add a short
   description and category, choose the licence, tick the rights
   confirmation, then **Publish**.

## Importing from a terminal

The command reads the folder on your computer and writes to whatever database
and storage your environment points at.

```bash
# Look first: plans and validates, writes nothing
pnpm import:assets ~/Downloads/01-Wood --dry-run --category wood

# Then import for real
pnpm import:assets ~/Downloads/01-Wood --category wood \
  --provenance-notes "Made by me in Substance, 2025."

# Models exported from Tripo AI
pnpm import:assets ~/Downloads/Archive --provenance ai_assisted \
  --provenance-notes "Generated with Tripo AI on the <plan name> plan."
```

Useful options: `--licence cc0-1.0` (only if it applies to every file),
`--tags a,b`, `--type decal` (for loose images that aren't textures),
`--manifest list.csv`, `--no-derive`, `--report out.json`,
`--actor you@example.com` (the admin account the import is recorded under).

A report (`import-report-….json`) lists every asset with its status and any
warnings.

**Local versus live.** With no `DATABASE_URL` set, the command imports into
your local development library under `.data/dev` (stop `pnpm dev` first; the
command refuses to share the local database with a running server). To import
into the live site, put the production values in `.env.local` on your own
computer, the same ones you entered in Vercel:

```
DATABASE_URL=…            # Supabase connection string (transaction pooler)
STORAGE_PROVIDER=r2
R2_ACCOUNT_ID=…
R2_ACCESS_KEY_ID=…
R2_SECRET_ACCESS_KEY=…
R2_PRIVATE_BUCKET=…
R2_PUBLIC_BUCKET=…
R2_PUBLIC_BASE_URL=…
APP_SECRET=…
```

Never commit `.env.local` or paste these values into chats or issues.

## Manifests (optional)

When folder names aren't enough, list the assets yourself. CSV:

```csv
title,type,files,category,licence,tags,provenance,provenanceNotes,shortDescription
Rusty barrel,model,props/barrel.fbx;props/barrel.png,props,cc0-1.0,"industrial, barrel",original,Modelled in Blender,A dented oil barrel with a rust texture.
```

or JSON:

```json
{
  "schema": "lowpo11y.import/1",
  "defaults": { "category": "props", "tags": ["kit-01"] },
  "assets": [
    { "title": "Rusty barrel", "type": "model", "files": ["props/barrel.fbx", "props/barrel.png"], "licence": "cc0-1.0" }
  ]
}
```

Paths are relative to the folder you import. `type` is one of model, texture,
decal, sprite, ui, audio, skybox, animation, pack. Licence codes are listed in
Admin → any asset → Licence (for example `cc0-1.0`, `cc-by-4.0`).

## Rights, honestly

An import never chooses a licence on its own and never ticks the rights
confirmation. Provenance notes should state facts you can stand behind: who
made the asset, with which tool or plan, under what agreement. If you are not
sure an asset can be shared, leave it as a draft.
