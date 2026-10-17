/**
 * LOWPO11Y's PSX-style material for three.js, as one GLSL file with a
 * vertex and a fragment half. It is the code published on /shaders (seeded
 * locally) and the code the live preview compiles; the E2E suite renders it
 * in Chromium on every change, which is what "tested" means for it.
 */
export const PSX_MATERIAL_GLSL = `// PSX-style material for three.js (THREE.ShaderMaterial).
// Vertex snapping, affine texture mapping, distance fog and 15-bit colour
// with ordered dithering. Split this file at the "--- fragment ---" line:
// the first half is the vertex shader, the second the fragment shader.

// --- vertex ---
uniform vec2 uResolution;   // size of the render target in pixels
uniform float uSnap;        // @control 40..480 = 120 "Vertex snap (rows)"
uniform float uAffine;      // @control 0..1 = 1 "Affine warp"

varying vec2 vUv;
varying vec3 vAffineUv;
varying float vFogDepth;

void main() {
  vec4 viewPos = modelViewMatrix * vec4(position, 1.0);
  vec4 clip = projectionMatrix * viewPos;

  // Snap to a coarse screen grid, like the PS1's integer vertex coordinates.
  // uSnap is the number of rows; columns follow the aspect ratio.
  vec2 grid = vec2(uSnap * uResolution.x / uResolution.y, uSnap) * 0.5;
  clip.xy = floor(clip.xy / clip.w * grid + 0.5) / grid * clip.w;
  gl_Position = clip;

  // Affine mapping: interpolate uv * w and w, then divide per pixel, so the
  // texture is linear in screen space and swims as polygons turn.
  vUv = uv;
  vAffineUv = vec3(uv * clip.w, clip.w);
  vFogDepth = -viewPos.z;
}

// --- fragment ---
uniform sampler2D map;
uniform float uAffine;
uniform float uLevels;      // @control 4..32 = 32 "Colour levels"
uniform float uDither;      // @control 0..1 = 1 "Dither"
uniform vec3 fogColor;
uniform float fogNear;
uniform float fogFar;

varying vec2 vUv;
varying vec3 vAffineUv;
varying float vFogDepth;

// 4x4 ordered-dither threshold in [0, 1).
float bayer2(vec2 a) {
  a = floor(a);
  return fract(dot(a, vec2(0.5, a.y * 0.75)));
}
float bayer4(vec2 a) {
  return bayer2(0.5 * a) * 0.25 + bayer2(a);
}

void main() {
  vec2 uv = mix(vUv, vAffineUv.xy / vAffineUv.z, uAffine);
  vec3 color = texture2D(map, uv).rgb;
  color = mix(color, fogColor, smoothstep(fogNear, fogFar, vFogDepth));

  // Quantise to uLevels per channel (the PS1 drew in 15-bit colour: 32 levels),
  // nudged by the dither pattern so gradients break into a fine grid, not bands.
  float steps = uLevels - 1.0;
  float threshold = (bayer4(gl_FragCoord.xy) - 0.5) * uDither;
  color = clamp(floor(color * steps + 0.5 + threshold) / steps, 0.0, 1.0);
  gl_FragColor = vec4(color, 1.0);
}
`;

export const PSX_MATERIAL_DOCS = {
  explanation: `Three effects that together read as "PlayStation":

- **Vertex snapping.** Each vertex is rounded to a coarse grid in screen space, the way the PS1's GPU took integer vertex coordinates. Edges jitter as the camera moves. The grid is in clip space, so it follows the screen, not the model.
- **Affine texture mapping.** The texture is interpolated in screen space instead of with perspective correction, so it bends and swims across large polygons. Mix it with \`uAffine\` between 0 (correct) and 1 (fully affine).
- **15-bit colour with ordered dithering.** The final colour is quantised to \`uLevels\` steps per channel after a 4×4 Bayer threshold, so gradients and fog break into a fine pattern rather than smooth bands.

Distance fog is linear between \`fogNear\` and \`fogFar\` in view space, applied before quantising, like the hardware's depth cueing.`,
  setup: `1. Split the file at the \`// --- fragment ---\` line into \`vertexShader\` and \`fragmentShader\`.
2. Create the material:

   \`\`\`js
   const [vertexShader, fragmentShader] = source.split("// --- fragment ---");
   const material = new THREE.ShaderMaterial({
     vertexShader,
     fragmentShader,
     uniforms: {
       map: { value: texture },
       uResolution: { value: new THREE.Vector2(320, 240) },
       uSnap: { value: 120 },
       uAffine: { value: 1 },
       uLevels: { value: 32 },
       uDither: { value: 1 },
       fogColor: { value: new THREE.Color(0x101010) },
       fogNear: { value: 4 },
       fogFar: { value: 18 },
     },
   });
   \`\`\`

3. Use nearest filtering on the texture (\`texture.magFilter = THREE.NearestFilter\`) and leave its \`colorSpace\` unset: the shader quantises in sRGB, as the console did.
4. For the full look, render at a low resolution (e.g. \`renderer.setSize(320, 240, false)\`) and scale the canvas up with \`image-rendering: pixelated\`. Keep \`uResolution\` equal to the render size.`,
  limitations: `- Unlit: it shows the texture and fog only. Multiply in your own lighting or vertex colours if you need them.
- Affine warping on large, close polygons is strong; subdivide floors and walls as PS1 games did.
- Snapping happens after projection, so vertices behind the camera aren't clipped any differently. Very large triangles that cross the near plane can pop.
- Not a skinning or instancing material. Add three.js's \`skinning\` chunks yourself for animated characters.`,
  changelog: "- 1.0: first version.",
};
