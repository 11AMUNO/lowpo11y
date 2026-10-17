/**
 * What the Workshop keeps in this browser. Recipes (saved pipelines) and the
 * current session's pipeline go in localStorage: small JSON, no images.
 * Images are kept only when the visitor turns on "Keep images on this
 * device", in IndexedDB, and are removed when it's turned off. Nothing here
 * leaves the browser.
 */
import { parsePipeline, serialisePipeline, type Pipeline } from "@/lib/workshop/pipeline";

const RECIPES_KEY = "lp-workshop-recipes";
const SESSION_KEY = "lp-workshop-session";
const DB_NAME = "lowpo11y-workshop";
const STORE = "inputs";

export interface Recipe {
  id: string;
  name: string;
  savedAt: string;
  json: string;
}

export class StorageFullError extends Error {}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && (e.name === "QuotaExceededError" || e.code === 22)) throw new StorageFullError("This browser's storage for the site is full. Delete some saved recipes and try again.");
    throw new StorageFullError("This browser isn't letting the site save (private browsing?). Export the recipe as a file instead.");
  }
}

export function listRecipes(): Recipe[] {
  try {
    const raw = JSON.parse(localStorage.getItem(RECIPES_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is Recipe => !!r && typeof r === "object" && typeof (r as Recipe).id === "string" && typeof (r as Recipe).json === "string");
  } catch {
    return [];
  }
}

/** Saves under the pipeline's name, replacing a recipe with the same name. */
export function saveRecipe(p: Pipeline): Recipe {
  const name = p.name.trim() || "Untitled pipeline";
  const others = listRecipes().filter((r) => r.name.toLowerCase() !== name.toLowerCase());
  const recipe: Recipe = { id: `r${Date.now().toString(36)}`, name, savedAt: new Date().toISOString(), json: serialisePipeline({ ...p, name }) };
  write(RECIPES_KEY, JSON.stringify([recipe, ...others].slice(0, 100)));
  return recipe;
}

export function deleteRecipe(id: string) {
  write(RECIPES_KEY, JSON.stringify(listRecipes().filter((r) => r.id !== id)));
}

export function loadRecipe(r: Recipe) {
  return parsePipeline(r.json);
}

export interface Session {
  pipeline: string;
  keepImages: boolean;
  concurrency: number;
}

export function saveSession(s: Session) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  } catch {
    // Not remembering the session is fine.
  }
}

export function loadSession(): { pipeline: Pipeline | null; keepImages: boolean; concurrency: number } {
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) ?? "null") as Partial<Session> | null;
    if (!raw) return { pipeline: null, keepImages: false, concurrency: 0 };
    let pipeline: Pipeline | null = null;
    try {
      pipeline = raw.pipeline ? parsePipeline(raw.pipeline).pipeline : null;
    } catch {
      pipeline = null;
    }
    return { pipeline, keepImages: raw.keepImages === true, concurrency: typeof raw.concurrency === "number" ? raw.concurrency : 0 };
  } catch {
    return { pipeline: null, keepImages: false, concurrency: 0 };
  }
}

/* ------------------------------------------------------- kept images */

export interface StoredInput {
  id: string;
  name: string;
  blob: Blob;
  origin?: { asset: string; url: string; licence: string | null };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB isn't available."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open the browser's storage."));
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error ?? new Error("Browser storage failed."));
      t.onabort = () => reject(t.error ?? new Error("Browser storage is full."));
    });
  } finally {
    db.close();
  }
}

export async function keepInputs(items: StoredInput[]): Promise<void> {
  await tx("readwrite", (s) => {
    s.clear();
    for (const i of items) s.put(i);
  });
}

export async function keptInputs(): Promise<StoredInput[]> {
  try {
    return ((await tx<StoredInput[]>("readonly", (s) => s.getAll() as IDBRequest<StoredInput[]>)) ?? []).filter((i) => i && i.blob instanceof Blob);
  } catch {
    return [];
  }
}

export async function forgetInputs(): Promise<void> {
  try {
    await tx("readwrite", (s) => void s.clear());
  } catch {
    // Nothing kept, or storage unavailable: nothing to forget.
  }
}

/** How much this site may store, for the "keep images" note. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    return e && typeof e.quota === "number" ? { usage: e.usage ?? 0, quota: e.quota } : null;
  } catch {
    return null;
  }
}
