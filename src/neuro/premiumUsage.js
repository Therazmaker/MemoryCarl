/**
 * premiumUsage.js — Tracker de uso premium diario
 * NeuroChat / MemoryCarl
 *
 * Controla hasta 20 llamadas premium por día desde el frontend.
 * Persiste en localStorage con namespace claro y manejo defensivo de datos corruptos.
 */

import { safeParse } from "./utils.js";

const STORAGE_KEY = "memorycarl_premium_usage";
const DEFAULT_LIMIT = 20;

// ---- Helpers ----

/**
 * Devuelve la fecha de hoy en formato YYYY-MM-DD (UTC local).
 * @returns {string}
 */
function todayDate() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

/**
 * Lee el estado del localStorage de forma defensiva.
 * @returns {{ date: string, used: number, limit: number, events: object[] }}
 */
function readState() {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return safeParse(raw, null);
  } catch (_e) {
    return null;
  }
}

/**
 * Escribe el estado en localStorage.
 * @param {object} state
 */
function writeState(state) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[premiumUsage] Error al guardar estado:", e);
  }
}

/**
 * Crea un estado limpio para hoy.
 * @param {number} [limit]
 * @returns {object}
 */
function freshState(limit = DEFAULT_LIMIT) {
  return {
    date:   todayDate(),
    used:   0,
    limit,
    events: [],
  };
}

/**
 * Valida y normaliza el estado leído; resetea si está corrupto o es de otro día.
 * @param {number} [limit]
 * @returns {object} estado válido para hoy
 */
function getValidState(limit = DEFAULT_LIMIT) {
  const raw = readState();
  const today = todayDate();

  if (!raw || typeof raw !== "object") return freshState(limit);
  if (raw.date !== today) return freshState(limit); // nuevo día → reset

  // Sanity checks
  const used  = typeof raw.used  === "number" && isFinite(raw.used)  ? Math.max(0, raw.used)  : 0;
  const lim   = typeof raw.limit === "number" && isFinite(raw.limit) ? Math.max(1, raw.limit) : limit;
  const events = Array.isArray(raw.events) ? raw.events : [];

  return { date: today, used, limit: lim, events };
}

// ---- API pública ----

/**
 * Devuelve el número de calls premium usados hoy.
 * @returns {number}
 */
export function getPremiumUsageToday() {
  return getValidState().used;
}

/**
 * Incrementa el contador de calls premium en 1 y registra el evento.
 *
 * @param {{ reason?: string, inputLabel?: string, inputPreview?: string }} [meta]
 * @returns {object} estado actualizado
 */
export function incrementPremiumUsage(meta = {}) {
  const state = getValidState();
  state.used += 1;
  state.events.push({
    timestamp:    new Date().toISOString(),
    reason:       meta.reason       || "premium_neuron_generation",
    inputLabel:   meta.inputLabel   || "unknown",
    inputPreview: String(meta.inputPreview || "").slice(0, 80),
  });
  writeState(state);
  return state;
}

/**
 * Indica si todavía quedan calls premium disponibles hoy.
 *
 * @param {{ limit?: number }} [options]
 * @returns {boolean}
 */
export function canUsePremiumCall(options = {}) {
  const state = getValidState(options.limit);
  return state.used < state.limit;
}

/**
 * Devuelve el estado completo del uso premium de hoy.
 *
 * @returns {{ date: string, used: number, remaining: number, limit: number, canUse: boolean, events: object[] }}
 */
export function getPremiumUsageState() {
  const state = getValidState();
  const remaining = Math.max(0, state.limit - state.used);
  return {
    date:      state.date,
    used:      state.used,
    remaining,
    limit:     state.limit,
    canUse:    state.used < state.limit,
    events:    state.events,
  };
}

/**
 * Fuerza el reset del contador si el día ha cambiado.
 * Se llama automáticamente en cada lectura, pero puede invocarse explícitamente.
 * @returns {boolean} true si se hizo reset
 */
export function resetPremiumUsageIfNeeded() {
  const raw = readState();
  if (!raw || raw.date !== todayDate()) {
    writeState(freshState(raw?.limit ?? DEFAULT_LIMIT));
    return true;
  }
  return false;
}
