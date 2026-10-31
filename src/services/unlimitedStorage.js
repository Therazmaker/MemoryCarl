/**
 * =====================================================================================
 * unlimitedStorage.js — Motor de Almacenamiento Local Sin Límite de 5 MB (RAM + IndexedDB)
 * MemoryCarl
 * =====================================================================================
 *
 * ¿POR QUÉ EXISTE ESTE MÓDULO?
 * `localStorage` en los navegadores tiene un límite estricto de ~5 MB para todo el dominio.
 * Cuando MemoryCarl acumula neuronas, días de chat, memorias, finanzas, Semana y FootballLab,
 * `localStorage` se llena al 100% y lanza `QuotaExceededError`, provocando que:
 *   1. No se puedan guardar ni siquiera las API Keys de Supabase ni el estado de sincronización.
 *   2. La cola offline (`memorycarl_offline_queue`) no pueda persistirse.
 *   3. `dayStore.js` ignore guardados en silencio y `neuronStore.js` / `memoryStore.js` recorten datos.
 *
 * ¿CÓMO LO SOLUCIONA?
 *   1. Mantiene una caché en memoria RAM (`ramStore`) de acceso 100% síncrono (0 ms) para que
 *      todas las lecturas `localStorage.getItem(key)` y escrituras `localStorage.setItem(key, val)`
 *      de toda la app funcionen al instante sin cambiar la arquitectura síncrona de los módulos.
 *   2. Persiste automáticamente todas las claves de datos en `IndexedDB` (`memorycarl_unlimited_db`,
 *      que soporta gigabytes de información en móvil y PC).
 *   3. Desaloja automáticamente de `localStorage` nativo cualquier clave pesada (> 4 KB),
 *      dejando `localStorage` nativo libre (< 30 KB en total) únicamente para claves pequeñas
 *      de configuración y credenciales.
 *   4. Nunca lanza `QuotaExceededError`.
 * =====================================================================================
 */

const IDB_NAME = "memorycarl_unlimited_db";
const IDB_VERSION = 1;
const IDB_STORE = "kv_store";

// Claves que SIEMPRE deben permanecer también en el localStorage nativo (son pequeñas y críticas en el arranque)
const NATIVE_KEEP_KEYS = new Set([
  "memorycarl_supabase_url",
  "memorycarl_supabase_anon_key",
  "memorycarl_script_api_key",
  "memorycarl_script_url",
  "memorycarl_api_key",
  "memorycarl_api_url",
  "memorycarl_neurochat_settings",
  "memorycarl_neurochat_sync_status",
  "memorycarl_dbservice_backfill_v3",
  "memorycarl_sync_pulled_once",
  "mc_ins_heat_mode",
  "mc_sheet_open",
]);

// Umbral máximo para mantener una copia en localStorage nativo (4 KB)
const MAX_NATIVE_BYTES = 4096;

// Caché síncrona en memoria RAM (clave -> string)
const ramStore = new Map();
const deletedKeys = new Set();

// Referencias a los métodos originales nativos de Storage
const nativeGetItem = Storage.prototype.getItem.bind(localStorage);
const nativeSetItem = Storage.prototype.setItem.bind(localStorage);
const nativeRemoveItem = Storage.prototype.removeItem.bind(localStorage);
const nativeKey = Storage.prototype.key.bind(localStorage);

let idbInstance = null;
let hydrationPromise = null;
let isHydrated = false;

// =====================================================================================
// 1. CONEXIÓN Y OPERACIONES CON INDEXEDDB (`memorycarl_unlimited_db`)
// =====================================================================================
function openUnlimitedIdb() {
  if (idbInstance) return Promise.resolve(idbInstance);
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      return reject(new Error("IndexedDB no soportado en este navegador"));
    }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      idbInstance = req.result;
      idbInstance.onclose = () => {
        idbInstance = null;
      };
      resolve(idbInstance);
    };
    req.onerror = () => reject(req.error || new Error("Error abriendo memorycarl_unlimited_db"));
  });
}

async function idbWrite(key, value) {
  try {
    const db = await openUnlimitedIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put({ key, value: String(value), updatedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`[unlimitedStorage] Error escribiendo "${key}" en IndexedDB:`, err);
  }
}

async function idbRemove(key) {
  try {
    const db = await openUnlimitedIdb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn(`[unlimitedStorage] Error borrando "${key}" en IndexedDB:`, err);
  }
}

async function idbReadAllFromStore(dbName, storeName) {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve([]);
    try {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.close();
          return resolve([]);
        }
        try {
          const tx = db.transaction(storeName, "readonly");
          const getAllReq = tx.objectStore(storeName).getAll();
          getAllReq.onsuccess = () => {
            const res = getAllReq.result || [];
            db.close();
            resolve(res);
          };
          getAllReq.onerror = () => {
            db.close();
            resolve([]);
          };
        } catch (_e) {
          db.close();
          resolve([]);
        }
      };
      req.onerror = () => resolve([]);
    } catch (_e) {
      resolve([]);
    }
  });
}

// =====================================================================================
// 2. CARGA INICIAL SÍNCRONA DESDE LOCALSTORAGE + MIGRACIÓN DE CLAVES PESADAS A IDB
// =====================================================================================
function bootstrapSyncFromNativeLocalStorage() {
  try {
    const keysToOffload = [];
    const total = localStorage.length;
    for (let i = 0; i < total; i++) {
      const k = nativeKey(i);
      if (!k) continue;
      const v = nativeGetItem(k);
      if (typeof v === "string") {
        ramStore.set(k, v);
        if (!NATIVE_KEEP_KEYS.has(k) && v.length > MAX_NATIVE_BYTES) {
          keysToOffload.push({ key: k, value: v });
        }
      }
    }

    // Mover asíncronamente las claves pesadas (> 4 KB) hacia IndexedDB y liberar espacio en localStorage nativo
    if (keysToOffload.length > 0) {
      Promise.all(keysToOffload.map((item) => idbWrite(item.key, item.value)))
        .then(() => {
          let freedBytes = 0;
          for (const item of keysToOffload) {
            try {
              nativeRemoveItem(item.key);
              freedBytes += item.value.length;
            } catch (_e) {}
          }
          console.log(
            `[unlimitedStorage] 🧹 Liberados ${Math.round(freedBytes / 1024)} KB de localStorage nativo (${keysToOffload.length} claves pesadas migradas a IndexedDB sin pérdida de datos).`
          );
        })
        .catch((err) => console.warn("[unlimitedStorage] Aviso al migrar claves pesadas:", err));
    }
  } catch (err) {
    console.warn("[unlimitedStorage] Error en lectura inicial de localStorage:", err);
  }
}

// =====================================================================================
// 3. VIRTUALIZACIÓN TRANSPARENTE DE `localStorage` (0 MS SÍNCRONO + BACKING EN IDB)
// =====================================================================================
function installStorageInterceptor() {
  if (typeof window === "undefined" || window.__mcUnlimitedStorageInstalled) return;
  window.__mcUnlimitedStorageInstalled = true;

  bootstrapSyncFromNativeLocalStorage();

  Storage.prototype.getItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      if (deletedKeys.has(k)) return null;
      if (ramStore.has(k)) return ramStore.get(k);
      const nativeVal = nativeGetItem(k);
      if (nativeVal !== null) {
        ramStore.set(k, nativeVal);
        return nativeVal;
      }
      return null;
    }
    return nativeGetItem.call(this, key);
  };

  Storage.prototype.setItem = function (key, value) {
    if (this === localStorage) {
      const k = String(key);
      const v = String(value);
      deletedKeys.delete(k);
      ramStore.set(k, v);

      // Persistir siempre en IndexedDB ilimitado
      idbWrite(k, v);

      // Si es una clave pequeña o de configuración, guardarla también en localStorage nativo;
      // si es pesada (> 4 KB), eliminar su copia vieja de localStorage nativo para no saturar los 5 MB.
      if (NATIVE_KEEP_KEYS.has(k) || v.length <= MAX_NATIVE_BYTES) {
        try {
          nativeSetItem(k, v);
        } catch (_quotaErr) {
          // Si incluso una clave pequeña falla porque había basura previa, limpiar claves pesadas de localStorage
          freeHeavyNativeKeys();
          try {
            nativeSetItem(k, v);
          } catch (_e2) {}
        }
      } else {
        try {
          nativeRemoveItem(k);
        } catch (_e) {}
      }
      return;
    }
    return nativeSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function (key) {
    if (this === localStorage) {
      const k = String(key);
      deletedKeys.add(k);
      ramStore.delete(k);
      try {
        nativeRemoveItem(k);
      } catch (_e) {}
      idbRemove(k);
      return;
    }
    return nativeRemoveItem.call(this, key);
  };
}

function freeHeavyNativeKeys() {
  try {
    const toRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = nativeKey(i);
      if (!k || NATIVE_KEEP_KEYS.has(k)) continue;
      const v = nativeGetItem(k);
      if (v && v.length > 1024) {
        ramStore.set(k, v);
        idbWrite(k, v);
        toRemove.push(k);
      }
    }
    for (const k of toRemove) {
      try {
        nativeRemoveItem(k);
      } catch (_e) {}
    }
  } catch (_e) {}
}

// =====================================================================================
// 4. HIDRATACIÓN COMPLETA DESDE INDEXEDDB AL ARRANCAR
// =====================================================================================
export function hydrateUnlimitedStorage() {
  installStorageInterceptor();
  if (hydrationPromise) return hydrationPromise;

  hydrationPromise = (async () => {
    try {
      // 1. Leer todas las claves de la base ilimitada principal (`memorycarl_unlimited_db`)
      const mainRows = await idbReadAllFromStore(IDB_NAME, IDB_STORE);
      for (const row of mainRows) {
        if (!row || typeof row.key !== "string" || deletedKeys.has(row.key)) continue;
        const val = row.value ?? row.payload;
        if (typeof val === "string") {
          // Si en localStorage nativo no estaba (porque fue desalojada por tamaño), cargarla a RAM
          if (!ramStore.has(row.key) || val.length >= (ramStore.get(row.key)?.length || 0)) {
            ramStore.set(row.key, val);
          }
        }
      }

      // 2. Migrar también cualquier clave que hubiera quedado en el fallback antiguo (`memorycarl_v2_storage`)
      const legacyRows = await idbReadAllFromStore("memorycarl_v2_storage", "kv");
      for (const row of legacyRows) {
        if (!row || typeof row.key !== "string" || deletedKeys.has(row.key)) continue;
        const val = row.payload ?? row.value;
        if (typeof val === "string" && !ramStore.has(row.key)) {
          ramStore.set(row.key, val);
          await idbWrite(row.key, val);
        }
      }

      isHydrated = true;
      if (typeof window !== "undefined") {
        window.__mcUnlimitedHydrated = true;
        window.dispatchEvent(new CustomEvent("memorycarl:storage-hydrated"));
      }
    } catch (err) {
      console.warn("[unlimitedStorage] Error hidratando desde IndexedDB:", err);
      isHydrated = true;
    }
    return ramStore;
  })();

  return hydrationPromise;
}

export function getStorageStats() {
  let ramBytes = 0;
  for (const v of ramStore.values()) {
    ramBytes += (v?.length || 0) * 2;
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
    totalKeys: ramStore.size,
    totalMB: (ramBytes / (1024 * 1024)).toFixed(2),
    nativeLocalStorageKB: Math.round(nativeBytes / 1024),
    isHydrated,
  };
}

// Instalar interceptor inmediatamente al importar el módulo
installStorageInterceptor();
hydrateUnlimitedStorage();
