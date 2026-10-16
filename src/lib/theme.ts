export const THEME_STORAGE_KEY = "lp-theme";
export type Theme = "dark" | "light";

/**
 * Applies the saved theme before first paint so there is no flash of the wrong theme.
 * Kept tiny and static so its CSP hash never changes (see src/lib/security/csp.ts).
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_STORAGE_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
