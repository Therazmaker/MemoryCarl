/**
 * =====================================================================================
 * syncOutbox.js — Adaptador hacia la Cola Inteligente (`memorycarl_offline_queue`)
 * MemoryCarl
 * =====================================================================================
 * NOTA DE REFACTORIZACIÓN:
 * Todo el sistema antiguo de outbox aislado (`memorycarl_sync_outbox_v1`) fue comentado
 * abajo como referencia histórica y reemplazado por `src/services/dbService.js`, que
 * unifica Finanzas, Hábitos, Semana, Casa, Sueño, Mood y NeuroChat en una sola cola
 * offline (`memorycarl_offline_queue`) con soporte de reconexión instantánea y fusión
 * de cambios repetidos.
 * =====================================================================================
 */

import {
  OFFLINE_QUEUE_KEY,
  loadOfflineQueue,
  getOfflineQueueCount,
  getPendingDeletesForTable,
  scheduleSync,
} from "./dbService.js";

export const OUTBOX_KEY = OFFLINE_QUEUE_KEY;

export function loadOutbox() {
  return loadOfflineQueue();
}

export function markChanged(_kind, _upserts = [], _deletes = [], _opts = {}) {
  // Dispara el escaneo incremental y encolado en dbService
  if (typeof window !== "undefined" && !window.__mcSuppressSync) {
    scheduleSync({ immediate: false });
  }
}

export function markAppStateChanged() {
  if (typeof window !== "undefined" && !window.__mcSuppressSync) {
    scheduleSync({ immediate: false });
  }
}

export function trackListChanges(_kind, _prevList = [], _nextList = [], _keyOf = (x) => x?.id) {
  if (typeof window !== "undefined" && !window.__mcSuppressSync) {
    scheduleSync({ immediate: false });
  }
}

export function chatKey(msg) {
  return `${msg?.ts}_${msg?.role}`;
}

export function pendingDeletes(kind) {
  const tableMap = {
    neurons: "neurons",
    memories: "memories",
    days: "days",
    chat: "chat_history",
  };
  return getPendingDeletesForTable(tableMap[kind] || kind);
}

export function pendingCount() {
  return getOfflineQueueCount();
}

export function ackSent(_sent = {}) {
  // Gestionado automáticamente por flushOfflineQueue() en dbService.js
}

/* =====================================================================================
 * CÓDIGO ANTERIOR COMENTADO (REFERENCIA HISTÓRICA - REEMPLAZADO POR dbService.js)
 * =====================================================================================
 *
 * export const OUTBOX_KEY = "memorycarl_sync_outbox_v1";
 * const KINDS = ["neurons", "memories", "days", "chat"];
 *
 * function emptyOutbox() {
 *   return { seq: 0, neurons: {}, memories: {}, days: {}, chat: {}, appState: 0 };
 * }
 *
 * export function loadOutbox() {
 *   try {
 *     const raw = typeof localStorage !== "undefined" ? localStorage.getItem(OUTBOX_KEY) : null;
 *     const parsed = raw ? JSON.parse(raw) : null;
 *     if (!parsed || typeof parsed !== "object") return emptyOutbox();
 *     const box = { ...emptyOutbox(), ...parsed };
 *     for (const k of KINDS) if (!box[k] || typeof box[k] !== "object") box[k] = {};
 *     return box;
 *   } catch (_e) {
 *     return emptyOutbox();
 *   }
 * }
 * ...
 * ===================================================================================== */
