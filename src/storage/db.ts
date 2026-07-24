const DB_NAME = "hrt-voice-trainer";
const DB_VERSION = 1;
export const SESSIONS_STORE = "sessions";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is unavailable in this browser/context."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        db.createObjectStore(SESSIONS_STORE, { keyPath: "id", autoIncrement: true });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  // A rejected open shouldn't be cached forever — e.g. a momentarily blocked upgrade (another
  // tab holding the DB open) can succeed on a later retry, so let the next call try again.
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function dbAdd<T>(storeName: string, value: T): Promise<IDBValidKey> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  const result = await promisify(tx.objectStore(storeName).add(value));
  return result;
}

export async function dbGetAll<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readonly");
  return promisify(tx.objectStore(storeName).getAll());
}

export async function dbDelete(storeName: string, key: IDBValidKey): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await promisify(tx.objectStore(storeName).delete(key));
}

export async function dbClear(storeName: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(storeName, "readwrite");
  await promisify(tx.objectStore(storeName).clear());
}
