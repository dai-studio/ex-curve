// src/host/idb.ts — a tiny promise wrapper over one IndexedDB object store (key → value).
// Every call fails soft (resolves undefined / no-op) when storage is unavailable, e.g. in a
// private window, so the app keeps working without persistence.

const DB = 'curve';
const STORE = 'kv';
let dbp: Promise<IDBDatabase | null> | null = null;

function open(): Promise<IDBDatabase | null> {
  dbp ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbp;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  return open().then((db) => new Promise((resolve) => {
    if (!db) return resolve(undefined);
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  }));
}

export const idbGet = <T>(key: string) => run<T>('readonly', (s) => s.get(key) as IDBRequest<T>);
export const idbSet = (key: string, value: unknown) => run('readwrite', (s) => s.put(value, key)).then(() => undefined);
export const idbDel = (key: string) => run('readwrite', (s) => s.delete(key)).then(() => undefined);
