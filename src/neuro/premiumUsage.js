/**
 * premiumUsage.js — Tracker de uso premium diario
 */

import { safeParse } from "./utils.js";

const STORAGE_KEY = "memorycarl_premium_usage";
const DEFAULT_LIMIT = 20;

function todayDate() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

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

function writeState(state) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn("[premiumUsage] Error al guardar estado:", e);
  }
}

function freshState(limit = DEFAULT_LIMIT) {
  return { date: todayDate(), used: 0, limit, events: [] };
}

function getValidState(limit = DEFAULT_LIMIT) {
  const raw = readState();
  const today = todayDate();

  if (!raw || typeof raw !== "object") return freshState(limit);
  if (raw.date !== today) return freshState(limit);

  const used = typeof raw.used === "number" && isFinite(raw.used) ? Math.max(0, raw.used) : 0;
  const lim = typeof raw.limit === "number" && isFinite(raw.limit) ? Math.max(1, raw.limit) : limit;
  const events = Array.isArray(raw.events) ? raw.events : [];
  return { date: today, used, limit: lim, events };
}

function resolveSpendingProfile(bootstrapState) {
  if (!bootstrapState?.enabled) return "conservative";
  return bootstrapState.level === "strong" ? "aggressive" : "balanced";
}

export function getPremiumUsageToday() {
  return getValidState().used;
}

export function incrementPremiumUsage(meta = {}) {
  const state = getValidState();
  state.used += 1;
  state.events.push({
    timestamp: new Date().toISOString(),
    reason: meta.reason || "premium_neuron_generation",
    inputLabel: meta.inputLabel || "unknown",
    inputPreview: String(meta.inputPreview || "").slice(0, 80),
  });
  writeState(state);
  return state;
}

export function canUsePremiumCall(options = {}) {
  const state = getValidState(options.limit);
  return state.used < state.limit;
}

export function getPremiumUsageState(options = {}) {
  const state = getValidState(options.limit);
  const remaining = Math.max(0, state.limit - state.used);
  return {
    date: state.date,
    used: state.used,
    remaining,
    limit: state.limit,
    canUse: state.used < state.limit,
    bootstrapSpendingProfile: resolveSpendingProfile(options.bootstrapState),
    events: state.events,
  };
}

export function resetPremiumUsageIfNeeded() {
  const raw = readState();
  if (!raw || raw.date !== todayDate()) {
    writeState(freshState(raw?.limit ?? DEFAULT_LIMIT));
    return true;
  }
  return false;
}
