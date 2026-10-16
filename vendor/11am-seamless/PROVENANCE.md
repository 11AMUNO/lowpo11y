# 11AM-Seamless v2 (original)

The site owner's own seamless-texture tool, supplied on 2026-10-16 for
integration into LOWPO11Y. Kept here unmodified as the reference
implementation:

- `src/lib/processing/seamless/engine.ts` is a TypeScript port of
  `engine.js`. `tests/e2e/seamless-regression.spec.ts` runs both in Chromium
  over a matrix of settings and requires byte-identical pixels.
- The `/tools/seamless` page reproduces `index.html` + `app.js` in React.
- `style.css` is the source of the site-wide design language (ADR 0007).

These files are not served by the site and are excluded from linting.
