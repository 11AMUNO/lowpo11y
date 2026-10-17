/**
 * What the Scene Builder keeps in this browser: the scene being edited
 * (autosaved to localStorage for recovery after a refresh or crash) and the
 * local model and texture files it uses (in IndexedDB, keyed by SHA-256, so
 * a recovered scene can find them again). Nothing is uploaded. "Clear
 * stored files" removes the files.
 */
const AUTOSAVE_KEY = "lp-scene-autosave";
const DB_NAME = "lowpo11y-scene";
const STORE = "files";

export interface Autosave {
  savedAt: string;
  json: string;
  /** Whether the user saved this version to a file. */
  clean: boolean;
}

export function readAutosave(): Autosave | null {
  try {
    const raw = JSON.parse(localStorage.getItem(AUTOSAVE_KEY) ?? "null") as Autosave | null;
    return raw && typeof raw.json === "string" ? raw : null;
  } catch {
    return null;
  }
}

/** Returns false when the browser refused (private mode or full). */
export function writeAutosave(a: Autosave): boolean {
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(a));
    return true;
  } catch {
    return false;
  }
}

export function clearAutosave() {
  try {
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // nothing stored
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB isn't available."));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Couldn't open the browser's storage."));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
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

export async function storeFile(sha256: string, bytes: Uint8Array): Promise<void> {
  await run("readwrite", (s) => void s.put(new Blob([bytes as BlobPart]), sha256));
}

export async function loadFile(sha256: string): Promise<Uint8Array | null> {
  try {
    const blob = (await run<Blob>("readonly", (s) => s.get(sha256) as IDBRequest<Blob>)) ?? null;
    return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

export async function clearFiles(): Promise<void> {
  try {
    await run("readwrite", (s) => void s.clear());
  } catch {
    // nothing stored
  }
}
