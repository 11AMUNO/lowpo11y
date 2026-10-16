export const CRT_STORAGE_KEY = "lp-crt";

/**
 * Applies the saved CRT-effects preference before first paint (no flash of
 * scanlines for people who turned them off). Kept tiny and static so its CSP
 * hash never changes (see src/lib/security/csp.ts).
 */
export const CRT_SCRIPT = `try{if(localStorage.getItem("${CRT_STORAGE_KEY}")==="off")document.documentElement.dataset.crt="off"}catch(e){}`;
