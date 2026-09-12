// db.js — minimal IndexedDB wrapper for CloudCard.
// Store shape (object store "contacts"):
// { id, name, company, title, phone, email, website, address,
//   tags: string[], notes, dateScanned, dateModified,
//   image: Blob, thumb: Blob }

const DB_NAME = "cloudcard";
const DB_VERSION = 1;
const STORE = "contacts";

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" });
        store.createIndex("dateScanned", "dateScanned");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeMode) {
  return openDB().then(
    (db) => db.transaction(STORE, storeMode).objectStore(STORE)
  );
}

export async function saveContact(contact) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.put(contact);
    req.onsuccess = () => resolve(contact);
    req.onerror = () => reject(req.error);
  });
}

export async function getContact(id) {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteContact(id) {
  const store = await tx("readwrite");
  return new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllContacts() {
  const store = await tx("readonly");
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const rows = req.result || [];
      rows.sort((a, b) => (b.dateModified || 0) - (a.dateModified || 0));
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export function newId() {
  return `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
