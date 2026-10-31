/**
 * =====================================================================================
 * neurochatSync.js — Adaptador de NeuroChat hacia el Motor Unificado (`dbService.js`)
 * MemoryCarl / NeuroChat
 * =====================================================================================
 * NOTA DE REFACTORIZACIÓN:
 * Antes NeuroChat tenía su propio ciclo de sincronización separado del resto de la app,
 * que dependía exclusivamente de `/api/sync` y `/api/restore` y chocaba con el guardado
 * de Finanzas en `app_state`.
 *
 * Ahora delega toda la sincronización a `src/services/dbService.js`, que:
 * - Usa conexión directa a Supabase (o fallback a Vercel API).
 * - Mantiene una cola offline unificada (`memorycarl_offline_queue`) con fusión de cambios.
 * - Sincroniza en tiempo real al recuperar internet (`online` event).
 * =====================================================================================
 */

import {
  SYNC_STATUS_KEY as DB_SYNC_STATUS_KEY,
  INITIAL_BACKFILL_DONE_KEY,
  getSupabaseConfig,
  getSyncStatus as dbGetSyncStatus,
  flushOfflineQueue,
  scheduleSync,
  pullFromSupabase,
  captureLocalChangesToQueue,
  loadOfflineQueue,
} from "./dbService.js";

export const SYNC_STATUS_KEY = DB_SYNC_STATUS_KEY;
export const BACKFILL_FLAG = INITIAL_BACKFILL_DONE_KEY;
export const PULLED_ONCE_FLAG = "memorycarl_sync_pulled_once";

/**
 * Devuelve la configuración actual de conexión (compatible con la interfaz de Ajustes de NeuroChat).
 */
export function getApiConfig() {
  return getSupabaseConfig();
}

/**
 * Devuelve el estado de la última sincronización.
 */
export function getSyncStatus() {
  return dbGetSyncStatus();
}

/**
 * Encola todos los registros locales para una subida completa inicial.
 */
export async function queueFullBackfill() {
  const changes = await captureLocalChangesToQueue({ forceAll: true });
  return changes > 0;
}

/**
 * Compatibilidad para inspección de lote pendiente.
 */
export async function buildOutboxBatch() {
  const q = loadOfflineQueue();
  const entries = Object.values(q.items || {});
  return {
    payload: q.items,
    sent: {},
    empty: entries.length === 0,
    items: entries.length,
  };
}

/**
 * Ejecuta inmediatamente el vaciado de la cola offline hacia Supabase.
 */
export async function pushNeurochatNow() {
  return await flushOfflineQueue({ isManual: true });
}

/**
 * Programa una subida con debounce o inmediata (`immediate: true`).
 */
export function schedulePush({ immediate = false } = {}) {
  return scheduleSync({ immediate });
}

/**
 * Descarga y fusiona desde Supabase sin pisar datos locales ni elementos en cola offline.
 */
export async function pullNeurochat(_opts = {}) {
  return await pullFromSupabase({ isManual: false });
}

/* =====================================================================================
 * CÓDIGO ANTERIOR COMENTADO (REFERENCIA HISTÓRICA - REEMPLAZADO POR dbService.js)
 * =====================================================================================
 *
 * const HISTORY_KEY = "memorycarl_neurochat_history";
 * const PUSH_DEBOUNCE_MS = 2500;
 * const TIMEOUT_MS = 30000;
 * const MAIN_APP_API_URL = "https://memory-carl.vercel.app";
 *
 * export function getApiConfig_LEGACY() {
 *   try {
 *     const ownUrl = (localStorage.getItem("memorycarl_api_url") || "").trim();
 *     const ownKey = (localStorage.getItem("memorycarl_api_key") || "").trim();
 *     const mainKey = (localStorage.getItem("memorycarl_script_api_key") || "").trim();
 *     const key = ownKey || mainKey;
 *     const url = (ownUrl || (key ? MAIN_APP_API_URL : "")).replace(/\/+$/, "");
 *     return { url, key, source: ownKey ? "neurochat" : mainKey ? "app" : "none" };
 *   } catch (_e) {
 *     return { url: "", key: "", source: "none" };
 *   }
 * }
 *
 * // El sistema anterior dividía en tandas manuales hacia /api/sync y fallaba cuando:
 * // 1. API_SECRET_KEY no coincidía o no estaba definida.
 * // 2. Faltaban tablas o índices únicos en Supabase.
 * // 3. Finanzas y NeuroChat sobreescribían app_state por separado.
 * ===================================================================================== */
