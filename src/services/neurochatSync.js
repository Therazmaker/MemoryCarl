/**
 * =====================================================================================
 * neurochatSync.js — Adaptador de NeuroChat hacia el Motor Unificado (`dbService.js`)
 * MemoryCarl / NeuroChat
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

export function getApiConfig() {
  return getSupabaseConfig();
}

export function getSyncStatus() {
  return dbGetSyncStatus();
}

/**
 * Encola el respaldo inicial completo SOLO UNA VEZ si no se ha hecho antes.
 */
export async function queueFullBackfill() {
  try {
    if (localStorage.getItem(INITIAL_BACKFILL_DONE_KEY) === "1") {
      return false;
    }
    const changes = await captureLocalChangesToQueue({ forceAll: true });
    localStorage.setItem(INITIAL_BACKFILL_DONE_KEY, "1");
    return changes > 0;
  } catch (_e) {
    return false;
  }
}

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

export async function pushNeurochatNow() {
  return await flushOfflineQueue({ isManual: true });
}

export function schedulePush({ immediate = false } = {}) {
  return scheduleSync({ immediate });
}

export const scheduleAutoSync = schedulePush;

export async function pullNeurochat(_opts = {}) {
  return await pullFromSupabase({ isManual: false });
}
