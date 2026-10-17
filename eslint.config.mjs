import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Catalogue thumbnails and tool canvases are pre-optimised derivatives or
      // local object URLs; next/image adds nothing there (see docs/decisions/0004).
      "@next/next/no-img-element": "off",
      // "// PANEL" titles and " // " separators are part of the terminal visual language, not comments.
      "react/jsx-no-comment-textnodes": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
      // zod comes from @/lib/zod, which turns off its eval probe (blocked by the CSP).
      "no-restricted-imports": ["error", { paths: [{ name: "zod", message: 'Import from "@/lib/zod" instead (it configures zod for the Content Security Policy).' }] }],
    },
  },
  {
    files: ["src/lib/zod.ts"],
    rules: { "no-restricted-imports": "off" },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    ".data/**",
    "coverage/**",
    "test-results/**",
    "playwright-report/**",
    // Owner-supplied reference implementation, kept byte-for-byte (see vendor/11am-seamless/PROVENANCE.md).
    "vendor/**",
  ]),
]);
