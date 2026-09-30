/**
 * financeDayHistory.js — Historial Diario de Finanzas y Rutina
 * MemoryCarl
 *
 * Persiste la memoria diaria en localStorage ("memorycarl_finance_day_history")
 * para permitir comparaciones entre días, patrones por día de la semana y cálculo de deltas.
 */

import { getLimaDate, getLimaDateString } from "./dailyFlowEngine.js";

export const FINANCE_DAY_HISTORY_LS_KEY = "memorycarl_finance_day_history";

/**
 * Carga la estructura de historial desde localStorage.
 * @returns {Record<string, {
 *   weekday: number,
 *   dailyFreeBudgetPlanned: number,
 *   totalSpentReal: number,
 *   difference: number,
 *   hadMobilityExpense: boolean,
 *   hadHomeLunchReady: boolean,
 *   ateOutAnyway: boolean,
 *   closed: boolean
 * }>}
 */
export function loadFinanceDayHistory() {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(FINANCE_DAY_HISTORY_LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

/**
 * Guarda la estructura de historial en localStorage.
 */
export function saveFinanceDayHistory(history) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(FINANCE_DAY_HISTORY_LS_KEY, JSON.stringify(history));
  } catch (_) {}
}

/**
 * Revisa el historial y cierra (closed: true) cualquier día anterior que continúe abierto.
 * Corre antes de registrar el snapshot del día actual.
 * @param {Date} [now]
 */
export function closeDayIfNeeded(now = new Date()) {
  const history = loadFinanceDayHistory();
  const todayStr = getLimaDateString(now);
  let updated = false;

  Object.keys(history).forEach(dateStr => {
    if (dateStr < todayStr && history[dateStr] && history[dateStr].closed === false) {
      history[dateStr].closed = true;
      updated = true;
    }
  });

  pruneOldEntries(120, now, history);

  if (updated) {
    saveFinanceDayHistory(history);
  }

  return history;
}

/**
 * Registra o actualiza el snapshot del día actual (closed: false).
 * @param {object} ctx - Resultado de buildDailyFlowContext()
 * @param {Date} [now]
 */
export function recordDailySnapshot(ctx, now = new Date()) {
  if (!ctx) return null;

  const history = loadFinanceDayHistory();
  const todayStr = getLimaDateString(now);
  const weekday = getLimaDate(now).getDay();

  const movements = Array.isArray(ctx.todayMovements) ? ctx.todayMovements : [];

  const hadMobilityExpense = movements.some(m => {
    const text = `${m.category || ""} ${m.note || ""}`.toLowerCase();
    return /movilidad|transporte|uber|taxi|bus|gasolina|combustible/.test(text);
  });

  const ateOutAnyway = Boolean(ctx.hasHomeLunchReady) && movements.some(m => {
    const text = `${m.category || ""} ${m.note || ""}`.toLowerCase();
    return /almuerzo|comida|menu|menú|restaurante/.test(text);
  });

  const existingEntry = history[todayStr];
  const dailyFreeBudgetPlanned = existingEntry?.dailyFreeBudgetPlanned ?? Number(ctx.liquidity?.dailyFreeBudget || 0);
  const totalSpentReal = Number(ctx.totalSpentToday || 0);
  const difference = Number((dailyFreeBudgetPlanned - totalSpentReal).toFixed(2));

  const entry = {
    weekday,
    dailyFreeBudgetPlanned,
    totalSpentReal,
    difference,
    hadMobilityExpense,
    hadHomeLunchReady: Boolean(ctx.hasHomeLunchReady),
    ateOutAnyway,
    closed: false
  };

  history[todayStr] = entry;
  saveFinanceDayHistory(history);

  return entry;
}

/**
 * Obtiene la entrada cerrada más reciente (debería corresponder al día anterior).
 * @param {Date} [now]
 * @returns {object|null}
 */
export function getYesterdaySnapshot(now = new Date()) {
  const history = loadFinanceDayHistory();
  const todayStr = getLimaDateString(now);

  const closedKeys = Object.keys(history)
    .filter(k => k < todayStr && history[k] && history[k].closed === true)
    .sort()
    .reverse();

  if (closedKeys.length === 0) return null;
  return history[closedKeys[0]];
}

/**
 * Obtiene hasta `limit` entradas cerradas cuyo `weekday` coincide, excluyendo `excludeDate`.
 * Devuelve el array ordenado de más reciente a más antigua.
 * @param {number} weekday - 0 (domingo) ... 6 (sábado)
 * @param {string} [excludeDate] - YYYY-MM-DD
 * @param {number} [limit] - defecto 8
 * @returns {Array<object>}
 */
export function getWeekdayPattern(weekday, excludeDate = null, limit = 8) {
  const history = loadFinanceDayHistory();

  const matching = Object.keys(history)
    .filter(k => k !== excludeDate && history[k] && history[k].closed === true && history[k].weekday === weekday)
    .sort()
    .reverse()
    .slice(0, limit)
    .map(k => history[k]);

  return matching;
}

/**
 * Borra entradas más viejas que `maxDays` respecto a la fecha actual.
 * @param {number} [maxDays] - defecto 120
 * @param {Date} [now]
 * @param {object} [inMemoryHistory]
 */
export function pruneOldEntries(maxDays = 120, now = new Date(), inMemoryHistory = null) {
  const history = inMemoryHistory || loadFinanceDayHistory();
  const cutoffDate = getLimaDate(now);
  cutoffDate.setDate(cutoffDate.getDate() - maxDays);
  const cutoffStr = getLimaDateString(cutoffDate);

  let modified = false;
  Object.keys(history).forEach(dateStr => {
    if (dateStr < cutoffStr) {
      delete history[dateStr];
      modified = true;
    }
  });

  if (modified && !inMemoryHistory) {
    saveFinanceDayHistory(history);
  }

  return history;
}
