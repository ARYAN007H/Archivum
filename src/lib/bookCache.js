// Offline full-book caching on IndexedDB. The raw fetch payload (plain text
// or serialized HTML) is stored after a successful load, so re-reads and
// airplane-mode opens render instantly without touching the network. The
// service worker only covers static assets — book bodies live here.
const DB_NAME = 'archivum-books';
const STORE = 'texts';
const DB_VERSION = 1;
// Bump when the fetch/format pipeline changes in a way that invalidates
// previously cached payloads.
const PAYLOAD_VERSION = 2;

let dbPromise = null;
const openDb = () => {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => { dbPromise = null; throw e; });
  return dbPromise;
};

export const bookCacheKey = (book) => {
  if (book?._source === 'archive' && book?._iaIdentifier) return `ia:${book._iaIdentifier}`;
  if (book?.id != null) return `gutenberg:${book.id}`;
  return null;
};

export async function getCachedBook(key) {
  if (!key || typeof indexedDB === 'undefined') return null;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(key);
      req.onsuccess = () => {
        const v = req.result;
        resolve(v && v.version === PAYLOAD_VERSION ? v : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function cacheBook(key, kind, data) {
  if (!key || typeof indexedDB === 'undefined') return false;
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ kind, data, version: PAYLOAD_VERSION, savedAt: Date.now() }, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false; // storage full / private mode — reading still works online
  }
}

export async function isBookCached(key) {
  return !!(await getCachedBook(key));
}
