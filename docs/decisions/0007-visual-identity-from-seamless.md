# 0007 — Visual identity follows the owner's 11AM-Seamless tool

**Context.** The owner supplied their existing seamless texture tool
(11AM-Seamless v2) and asked that the whole project match its style. M01 had
shipped a warm-graphite, amber-accent design with Archivo and a light theme.

**Decision.** Re-theme the entire design system to Seamless:
- Monochrome palette on `#000` (BH-PromptEngine tokens), white CRT glow,
  scanlines + vignette + flicker overlay.
- IBM Plex Mono for content and Share Tech Mono for labels and controls, both
  self-hosted via Fontsource (Seamless loads them from Google Fonts).
- Square corners, uppercase bracketed buttons, `// PANEL` titles, `>` prompts,
  ASCII level bars, numbered pipeline modules with ON/OFF switches.
- The home page opens with an ANSI Shadow ASCII banner, as Seamless does.

**Deviations from Seamless, for accessibility.**
- Seamless's dim grey (`#4a4a4a`, 2.4:1) is used only for decorative,
  `aria-hidden` marks; informative hints use `#8e8e8e` (6.4:1).
- Input borders use `#6b6b6b` (3.9:1) to meet WCAG 1.4.11 non-text contrast.
- A **CRT on/off** switch lets visitors remove the overlay and glow.

**Superseded.** The light theme and amber accent from M01 are removed; the
font choice in ADR 0006 is replaced by the faces above. Component APIs were
kept, so pages did not need rewriting.
