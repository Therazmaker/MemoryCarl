/**
 * finance_storage.js — Persistencia de finance_v2_state en IndexedDB.
 *
 * Por qué existe: localStorage tiene ~5 MB por origen y ya se llena (QuotaExceededError),
 * lo que hacía que finance_v2_state no se guardara y el ledger apareciera vacío en cada arranque.
 *
 * API (todo async, nunca lanza): getFinanceBlob(), setFinanceBlob(str), isFinanceStorageAvailable().
 * Se puede inyectar un adaptador en tests con setFinanceStorageAdapter({ get, set }).
 */

const DB_NAME = "memorycarl_finance";
const DB_VERSION = 1;
const STORE = "kv";
const KEY = "finance_v2_state";

let _adapter = null;
let _dbPromise = null;

export function setFinanceStorageAdapter(adapter) {
  _adapter = adapter || null;
  _dbPromise = null;
}

export function isFinanceStorageAvailable() {
  if (_adapter) return true;
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch (_e) {
    return false;
  }
}

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open error"));
      req.onblocked = () => reject(new Error("IndexedDB open blocked"));
    } catch (err) {
      reject(err);
    }
  });
  _dbPromise.catch(() => { _dbPromise = null; });
  return _dbPromise;
}

/** @returns {Promise<string|null>} JSON string guardado, o null si no hay / si falla */
export async function getFinanceBlob() {
  try {
    if (_adapter) return (await _adapter.get(KEY)) ?? null;
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
    });
  } catch (err) {
    console.warn("[finance_storage] No se pudo leer IndexedDB:", err);
    return null;
  }
}

/** @returns {Promise<boolean>} true solo si la escritura quedó confirmada */
export async function setFinanceBlob(jsonString) {
  try {
    if (_adapter) {
      await _adapter.set(KEY, jsonString);
      return true;
    }
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(jsonString, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("IndexedDB tx abort"));
    });
    return true;
  } catch (err) {
    console.warn("[finance_storage] No se pudo escribir IndexedDB:", err);
    return false;
  }
}
