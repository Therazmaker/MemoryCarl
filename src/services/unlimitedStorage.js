/**
 * =====================================================================================
 * unlimitedStorage.js — Almacenamiento Híbrido de Bajo Consumo de RAM (LocalStorage + IDB)
 * MemoryCarl — Edición Anti-OOM para Móviles
 * =====================================================================================
 *
 * ¿CÓMO EVITA CRASHES DE MEMORIA ("¡Oh, no! Se produjo un error") EN MÓVILES?
 * 1. NO duplica todo `localStorage` en RAM:
 *    Si una clave ya cabe y vive en `localStorage` nativo, la lee directo de `localStorage`
 *    nativo sin clonarla en un `Map` en RAM.
 * 2. `overflowRamStore` solo guarda en RAM las claves que desbordaron la cuota de 5 MB
 *    de `localStorage` y tuvieron que moverse a `IndexedDB`.
 * 3. Al arrancar, elimina directamente en `IndexedDB` (sin cargar en RAM) cualquier
 *    cola antigua pesada (`memorycarl_offline_queue`) que haya quedado del crash anterior.
 * =====================================================================================
 */

const IDB_NAME = "memorycarl_unlimited_db";
const IDB_VERSION = 1;
const IDB_STORE = "kv_store";

// Solo las claves que NO cupieron en localStorage nativo viven en este Map
const overflowRamStore = new Map();

const nativeGetItem = Storage.prototype.getItem.bind(localStorage);
const nativeSetItem = Storage.prototype.setItem.bind(localStorage);
const nativeRemoveItem = Storage.prototype.removeItem.bind(localStorage);
const nativeKey = Storage.prototype.key.bind(localStorage);

let idbOpenPromise = null;
let hydrationPromise = null;
let isHydrated = false;

const pendingIdbWrites = new Map();
let idbFlushTimer = null;

function isQuotaError(err) {
  if (!err) return false;
  return err.name === "QuotaExceededError" || err.code === 22 || err.code === 1014;
}

// =====================================================================================
// 1. CONEXIÓN SINGLETON Y ESCRITURA AGRUPADA EN INDEXEDDB
// =====================================================================================
function openUnlimitedIdb() {
  if (idbOpenPromise) return idbOpenPromise;
  idbOpenPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      idbOpenPromise = null;
      return reject(new Error("IndexedDB no disponible"));
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => {
        idbOpenPromise = null;
      };
      db.onversionchange = () => {
        db.close();
        idbOpenPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      idbOpenPromise = null;
      reject(req.error || new Error("Error abriendo memorycarl_unlimited_db"));
    };
  });
  return idbOpenPromise;
}

function scheduleIdbFlush() {
  if (idbFlushTimer) return;
  idbFlushTimer = setTimeout(flushPendingIdbWrites, 300);
}

async function flushPendingIdbWrites() {
  idbFlushTimer = null;
  if (pendingIdbWrites.size === 0) return;

  const batch = new Map(pendingIdbWrites);
  pendingIdbWrites.clear();

  try {
    const db = await openUnlimitedIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      const store = tx.objectStore(IDB_STORE);
      const now = Date.now();
      for (const [key, val] of batch.entries()) {
        if (val === null) {
          store.delete(key);
        } else {
          store.put({ key, value: String(val), updatedAt: now });
        }
      }
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("[unlimitedStorage] Aviso en escritura IndexedDB:", err);
  }
}

function queueIdbWrite(key, value) {
  pendingIdbWrites.set(key, String(value));
  scheduleIdbFlush();
}

function queueIdbDelete(key) {
  pendingIdbWrites.set(key, null);
  scheduleIdbFlush();
}

// =====================================================================================
// 2. INTERCEPTOR LIGERO DE `localStorage` (SOLO USA IDB SI LOCALSTORAGE ESTÁ LLENO)
// =====================================================================================
function installStorageInterceptor() {
  if (typeof window === "undefined" || window.__mcUnlimitedStorageInstalled) return;
  window.__mcUnlimitedStorageInstalled = true;

  // Limpiar de inmediato colas antiguas en localStorage que causaban el crash al recargar
  try {
    nativeRemoveItem("memorycarl_offline_queue");
    nativeRemoveItem("memorycarl_sync_hashes_v3");
    nativeRemoveItem("memorycarl_sync_outbox_v1");
  } catch (_e) {}

  Storage.prototype.getItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      if (overflowRamStore.has(k)) {
        return overflowRamStore.get(k);
      }
      return nativeGetItem(k);
    }
    return nativeGetItem.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage) {
      const k = String(key);
      const v = String(value);

      // Si esta clave ya fue migrada a IndexedDB por exceso de cuota, mantenerla en IDB
      if (overflowRamStore.has(k)) {
        overflowRamStore.set(k, v);
        queueIdbWrite(k, v);
        return;
      }

      // Intentar guardar en localStorage nativo primero (0 uso extra de RAM)
      try {
        nativeSetItem(k, v);
        return;
      } catch (err) {
        if (!isQuotaError(err)) throw err;

        // Si localStorage nativo se llenó (5 MB), liberar la clave más pesada hacia IDB
        offloadHeaviestKeyFromNativeStorage();

        // Reintentar en localStorage nativo si la clave actual es pequeña (< 32 KB)
        if (v.length < 32768) {
          try {
            nativeSetItem(k, v);
            return;
          } catch (_err2) {}
        }

        // Si sigue sin caber o es pesada, guardarla en overflowRamStore + IndexedDB
        try {
          nativeRemoveItem(k);
        } catch (_e) {}
        overflowRamStore.set(k, v);
        queueIdbWrite(k, v);
        return;
      }
    }
    return nativeSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      if (overflowRamStore.has(k)) {
        overflowRamStore.delete(k);
        queueIdbDelete(k);
      }
      try {
        nativeRemoveItem(k);
      } catch (_e) {}
      return;
    }
    return nativeRemoveItem.call(this, key);
  };
}

/**
 * Busca las 2 claves más pesadas en `localStorage` nativo y las pasa a IndexedDB
 * para dejar espacio libre inmediato sin duplicar el resto de claves en RAM.
 */
function offloadHeaviestKeyFromNativeStorage() {
  try {
    const candidates = [];
    const len = localStorage.length;
    for (let i = 0; i < len; i++) {
      const k = nativeKey(i);
      if (!k || k.includes("supabase") || k.includes("api_key") || k.includes("settings")) continue;
      const v = nativeGetItem(k);
      if (v && v.length > 50000) {
        candidates.push({ key: k, length: v.length, value: v });
      }
    }
    candidates.sort((a, b) => b.length - a.length);
    for (const item of candidates.slice(0, 2)) {
      overflowRamStore.set(item.key, item.value);
      queueIdbWrite(item.key, item.value);
      try {
        nativeRemoveItem(item.key);
      } catch (_e) {}
    }
  } catch (_e) {}
}

// =====================================================================================
// 3. HIDRATACIÓN SEGURA CON CURSOR (SIN `getAll()` MASIVO QUE CAUSE OOM)
// =====================================================================================
export function hydrateUnlimitedStorage() {
  installStorageInterceptor();
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      const db = await openUnlimitedIdb();

      // Primero borrar en IndexedDB (a nivel nativo sin leer a RAM) cualquier cola pesada vieja
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          const store = tx.objectStore(IDB_STORE);
          store.delete("memorycarl_offline_queue");
          store.delete("memorycarl_sync_hashes_v3");
          tx.oncomplete = resolve;
          tx.onerror = resolve;
        } catch (_e) {
          resolve();
        }
      });

      // Leer mediante cursor solo las claves que NO están ya en localStorage nativo
      await new Promise((resolve) => {
        try {
          const tx = db.transaction(IDB_STORE, "readonly");
          const store = tx.objectStore(IDB_STORE);
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = (ev) => {
            const cursor = ev.target.result;
            if (!cursor) return resolve();
            const row = cursor.value;
            const k = row?.key;
            const v = row?.value ?? row?.payload;
            if (typeof k === "string" && typeof v === "string") {
              // Si cabe de vuelta en localStorage nativo y no está ahí, restaurarlo a nativo
              // salvo que supere 250 KB, en cuyo caso se queda en overflowRamStore
              if (nativeGetItem(k) === null) {
                if (v.length < 100000) {
                  try {
                    nativeSetItem(k, v);
                  } catch (_e) {
                    overflowRamStore.set(k, v);
                  }
                } else {
                  overflowRamStore.set(k, v);
                }
              }
            }
            cursor.continue();
          };
          cursorReq.onerror = () => resolve();
        } catch (_e) {
          resolve();
        }
      });

      isHydrated = true;
      if (typeof window !== "undefined") {
        window.__mcUnlimitedHydrated = true;
        window.dispatchEvent(new CustomEvent("memorycarl:storage-hydrated"));
      }
    } catch (err) {
      console.warn("[unlimitedStorage] Aviso en hidratación:", err);
      isHydrated = true;
    }
    return overflowRamStore;
  })();

  return hydrationPromise;
}

export function getStorageStats() {
  let overflowBytes = 0;
  for (const v of overflowRamStore.values()) {
    overflowBytes += (v?.length || 0) * 2;
  }
  let nativeBytes = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = nativeKey(i);
      const v = k ? nativeGetItem(k) : "";
      nativeBytes += ((k?.length || 0) + (v?.length || 0)) * 2;
    }
  } catch (_e) {}

  return {
    totalKeys: localStorage.length + overflowRamStore.size,
    totalMB: ((nativeBytes + overflowBytes) / (1024 * 1024)).toFixed(2),
    nativeLocalStorageKB: Math.round(nativeBytes / 1024),
    isHydrated,
  };
}

installStorageInterceptor();
hydrateUnlimitedStorage();
