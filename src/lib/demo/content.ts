/**
 * Starting content for Shaders & Code and Resources, written for LOWPO11Y.
 *
 * - The three.js PSX material is ours and is compiled and rendered by the
 *   site's own browser tests. The local demo seed publishes it (CC0, like
 *   the rest of the demo library); `pnpm db:seed-content` adds it to any
 *   database as a draft so the owner chooses its licence and publishes it.
 * - The Godot shaders are drafts. They haven't been run in Godot yet, so
 *   they can't be published (the database requires a test date) until
 *   someone opens them in the editor and records the result.
 * - Resource links are drafts too: this environment can't reach the sites,
 *   so each needs a review (link, licence) before it can go live.
 *
 * Idempotent by slug; existing rows are never changed.
 */
import { REVISION } from "three";
import type { Tx } from "@/lib/db";
import type { AssetStorage } from "@/lib/storage";
import { PSX_MATERIAL_DOCS, PSX_MATERIAL_GLSL } from "@/lib/shaders/psx-material";
import { publishWithFile } from "@/lib/content/files";
import { createContent } from "@/lib/content/repository";
import { resourceInputSchema, shaderInputSchema } from "@/lib/content/schemas";

const GODOT_PSX_SPATIAL = `shader_type spatial;
render_mode unshaded, cull_back;

// PSX-style surface for Godot 4: vertex snapping and affine texture mapping.
// Godot's own fog still applies. Use with a low-resolution viewport for the full look.

uniform sampler2D albedo_texture : source_color, filter_nearest, repeat_enable;
uniform vec2 snap_resolution = vec2(320.0, 240.0);
uniform float affine_strength : hint_range(0.0, 1.0) = 1.0;

varying vec3 affine_uv;

void vertex() {
\tvec4 clip = PROJECTION_MATRIX * (MODELVIEW_MATRIX * vec4(VERTEX, 1.0));
\tvec2 grid = snap_resolution * 0.5;
\tclip.xy = round(clip.xy / clip.w * grid) / grid * clip.w;
\tPOSITION = clip;
\t// Interpolate uv * w and w, divide per pixel: linear in screen space.
\taffine_uv = vec3(UV * clip.w, clip.w);
}

void fragment() {
\tvec2 uv = mix(UV, affine_uv.xy / affine_uv.z, affine_strength);
\tALBEDO = texture(albedo_texture, uv).rgb;
}
`;

const GODOT_DITHER_POST = `shader_type canvas_item;

// Full-screen 15-bit colour with 4x4 ordered dithering for Godot 4.
// Put it on a ColorRect that covers the screen, above the 3D view.

uniform sampler2D screen_texture : hint_screen_texture, filter_nearest;
uniform float levels : hint_range(2.0, 32.0) = 32.0;
uniform float dither_strength : hint_range(0.0, 1.0) = 1.0;

float bayer2(vec2 a) {
\ta = floor(a);
\treturn fract(dot(a, vec2(0.5, a.y * 0.75)));
}

float bayer4(vec2 a) {
\treturn bayer2(0.5 * a) * 0.25 + bayer2(a);
}

void fragment() {
\tvec3 color = texture(screen_texture, SCREEN_UV).rgb;
\tfloat steps = levels - 1.0;
\tfloat threshold = (bayer4(FRAGCOORD.xy) - 0.5) * dither_strength;
\tCOLOR = vec4(clamp(floor(color * steps + 0.5 + threshold) / steps, 0.0, 1.0), 1.0);
}
`;

/** Draft resources. Licence notes are from memory and must be checked on each site before publishing. */
const RESOURCES: { slug: string; title: string; url: string; category: string; description: string; licence_note: string }[] = [
  { slug: "poly-haven", title: "Poly Haven", url: "https://polyhaven.com/", category: "textures", description: "Photo-scanned textures, HDRIs and models at high resolution. Downscale and posterise them for a retro look.", licence_note: "CC0" },
  { slug: "ambientcg", title: "ambientCG", url: "https://ambientcg.com/", category: "textures", description: "PBR materials and textures. The albedo maps work well as a starting point for low-resolution textures.", licence_note: "CC0" },
  { slug: "kenney-assets", title: "Kenney", url: "https://kenney.nl/assets", category: "models", description: "Large library of game assets, including low-poly 3D kits, UI packs and sound effects.", licence_note: "CC0" },
  { slug: "quaternius", title: "Quaternius", url: "https://quaternius.com/", category: "models", description: "Low-poly model packs, many rigged and animated: characters, nature, buildings and props.", licence_note: "CC0" },
  { slug: "freesound", title: "Freesound", url: "https://freesound.org/", category: "audio", description: "Community library of sound effects and field recordings.", licence_note: "Each sound has its own licence (CC0, CC BY or CC BY-NC); check before use" },
  { slug: "blender", title: "Blender", url: "https://www.blender.org/", category: "tools", description: "Free 3D modelling, UV unwrapping, texture painting and animation. Exports glTF for the web and Godot.", licence_note: "GPL; what you make with it is yours" },
  { slug: "blockbench", title: "Blockbench", url: "https://www.blockbench.net/", category: "tools", description: "Simple low-poly modelling and texture painting tool, quick for props and blocky characters.", licence_note: "GPL; what you make with it is yours" },
  { slug: "godot-docs", title: "Godot documentation", url: "https://docs.godotengine.org/", category: "docs", description: "The official Godot manual and class reference, including the shading language.", licence_note: "Docs CC BY 3.0; engine MIT" },
  { slug: "threejs-docs", title: "three.js documentation", url: "https://threejs.org/docs/", category: "docs", description: "Reference for three.js, the WebGL library this site's 3D views use.", licence_note: "MIT" },
  { slug: "gltf-spec", title: "glTF 2.0 specification", url: "https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html", category: "docs", description: "The format behind GLB files: meshes, materials, skins and animations, and what each field means.", licence_note: "Khronos specification; free to read" },
  { slug: "lospec-palettes", title: "Lospec palette list", url: "https://lospec.com/palette-list", category: "learning", description: "Searchable list of limited colour palettes for pixel art and low-colour textures.", licence_note: "Palettes are shared by their authors; check each one" },
];

export interface ContentSeedResult {
  created: string[];
  skipped: string[];
}

export async function seedSiteContent(
  tx: Tx,
  storage: AssetStorage,
  opts: { publish: boolean; siteUrl: string },
  log: (s: string) => void = () => {},
): Promise<ContentSeedResult> {
  const result: ContentSeedResult = { created: [], skipped: [] };
  const existing = async (table: string) => new Set((await tx.asUser((q) => q.query<{ slug: string }>(`select slug from ${table}`))).map((r) => r.slug));
  const shaders = await existing("shader_resources");
  const resources = await existing("external_resources");
  const [cc0] = await tx.asUser((q) => q.query<{ id: string }>("select id from licences where code = 'cc0-1.0'"));

  const shaderEntries = [
    shaderInputSchema.parse({
      slug: "psx-material-threejs",
      title: "PSX material for three.js",
      summary: "Vertex snapping, affine texture warping, distance fog and 15-bit dithered colour in one ShaderMaterial.",
      engine: "threejs",
      engine_version_min: `r${REVISION}`,
      renderer_compatibility: "WebGLRenderer, WebGL 2",
      licence_id: opts.publish ? (cc0?.id ?? null) : null,
      explanation_md: PSX_MATERIAL_DOCS.explanation,
      setup_md: PSX_MATERIAL_DOCS.setup,
      limitations_md: PSX_MATERIAL_DOCS.limitations,
      changelog_md: PSX_MATERIAL_DOCS.changelog,
      code: PSX_MATERIAL_GLSL,
      code_language: "glsl",
      // Locally the browser tests compile and render it on every run; elsewhere the owner tests it in the admin preview first.
      tested_at: opts.publish ? new Date().toISOString() : null,
      tested_notes: opts.publish ? "Compiled and rendered in this site's live preview by the automated browser tests (Chromium, WebGL 2)" : null,
      tags: ["vertex snapping", "affine mapping", "dithering", "fog"],
      featured: true,
    }),
    shaderInputSchema.parse({
      slug: "psx-surface-godot",
      title: "PSX surface for Godot 4",
      summary: "Spatial shader with vertex snapping and affine texture mapping.",
      engine: "godot",
      engine_version_min: "4.2",
      renderer_compatibility: "Forward+, Mobile, Compatibility",
      explanation_md:
        "Rounds each vertex to a screen-space grid after projection, like the PS1's integer vertex coordinates, and interpolates UVs without perspective correction so textures swim across large polygons. `affine_strength` mixes between correct (0) and fully affine (1) mapping.",
      setup_md: "1. Create a ShaderMaterial on your MeshInstance3D and load this shader.\n2. Set `albedo_texture` to your texture.\n3. Set `snap_resolution` to your target resolution, e.g. 320×240.\n4. For the full look, render the 3D view into a low-resolution SubViewport and scale it up with nearest filtering.",
      limitations_md: "- Unshaded: lighting isn't applied. Remove `unshaded` and write your own `light()` if you need it.\n- Large, close polygons warp a lot; subdivide floors and walls.",
      code: GODOT_PSX_SPATIAL,
      code_language: "gdshader",
      tags: ["vertex snapping", "affine mapping"],
    }),
    shaderInputSchema.parse({
      slug: "dither-15bit-godot",
      title: "15-bit dither post-process for Godot 4",
      summary: "Screen-space ordered dithering and colour quantising, as on the PS1.",
      engine: "godot",
      engine_version_min: "4.2",
      explanation_md: "Reads the screen, quantises each channel to `levels` steps after a 4×4 Bayer threshold, and writes it back. 32 levels per channel matches the PS1's 15-bit colour.",
      setup_md: "1. Add a CanvasLayer with a ColorRect that fills the screen (anchors: full rect).\n2. Give the ColorRect a ShaderMaterial with this shader.\n3. Set `mouse_filter` on the ColorRect to Ignore so it doesn't block input.",
      limitations_md: "- Dithers the UI too if the UI is drawn below the ColorRect's layer. Put the effect layer between the 3D view and the UI.\n- At native resolution the pattern is very fine; it reads best at low resolution.",
      code: GODOT_DITHER_POST,
      code_language: "gdshader",
      tags: ["dithering", "post-process"],
    }),
  ];

  for (const input of shaderEntries) {
    if (shaders.has(input.slug)) {
      result.skipped.push(input.slug);
      continue;
    }
    const row = await tx.asUser((q) => createContent(q, "shader", input));
    if (opts.publish && input.engine === "threejs") {
      await publishWithFile(tx, storage, "shader", row.id, opts.siteUrl);
      log(`  published shader ${input.slug}`);
    } else log(`  drafted shader ${input.slug}`);
    result.created.push(input.slug);
  }

  for (const r of RESOURCES) {
    if (resources.has(r.slug)) {
      result.skipped.push(r.slug);
      continue;
    }
    await tx.asUser((q) =>
      createContent(q, "resource", resourceInputSchema.parse({ ...r, review_notes: "Added by the starter content. The link and licence note were written from memory: open the site, confirm both, then set the review date." })),
    );
    result.created.push(r.slug);
  }
  log(`  drafted ${RESOURCES.filter((r) => !resources.has(r.slug)).length} resource links for review`);
  return result;
}
