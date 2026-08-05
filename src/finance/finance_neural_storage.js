const BRAIN_STORAGE_KEY = 'memorycarl_finance_brain_v2';
const LEGACY_NEURON_KEY = 'memorycarl_neuronas_financieras';
const EPISODIC_MEMORY_KEY = 'memorycarl_episodic_memory_v1';

const DEFAULT_BRAIN_STATE = {
  version: 2,
  lastScanAt: null,
  latestScanSummary: null,
  neuronRegistry: [],
  hippocampus: {
    daily: {},
    weekly: {},
    monthly: {},
    patternHistory: [],
    neuronHistory: []
  },
  insights: [],
  legacyNeuronas: [],
  episodicMemory: []
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch (_e) {
    return null;
  }
}

function normalizeBrainState(raw) {
  const base = clone(DEFAULT_BRAIN_STATE);
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  merged.hippocampus = {
    ...base.hippocampus,
    ...(raw.hippocampus || {})
  };
  merged.neuronRegistry = Array.isArray(raw.neuronRegistry) ? raw.neuronRegistry : [];
  merged.insights = Array.isArray(raw.insights) ? raw.insights : [];
  merged.legacyNeuronas = Array.isArray(raw.legacyNeuronas) ? raw.legacyNeuronas : [];
  merged.episodicMemory = Array.isArray(raw.episodicMemory) ? raw.episodicMemory : [];
  return merged;
}

/**
 * Trims the brain state so it stays under a safe storage size.
 * Caps arrays and removes old hippocampus daily/weekly entries.
 */
function trimBrainState(state) {
  const trimmed = { ...state };

  // Keep only last 50 insights
  if (Array.isArray(trimmed.insights) && trimmed.insights.length > 50) {
    trimmed.insights = trimmed.insights.slice(-50);
  }

  // Keep only last 100 episodic memories
  if (Array.isArray(trimmed.episodicMemory) && trimmed.episodicMemory.length > 100) {
    trimmed.episodicMemory = trimmed.episodicMemory.slice(-100);
  }

  // Keep only last 50 neurons in registry
  if (Array.isArray(trimmed.neuronRegistry) && trimmed.neuronRegistry.length > 50) {
    trimmed.neuronRegistry = trimmed.neuronRegistry.slice(-50);
  }

  // Trim hippocampus history arrays
  if (trimmed.hippocampus) {
    const hc = { ...trimmed.hippocampus };

    if (Array.isArray(hc.patternHistory) && hc.patternHistory.length > 30) {
      hc.patternHistory = hc.patternHistory.slice(-30);
    }
    if (Array.isArray(hc.neuronHistory) && hc.neuronHistory.length > 30) {
      hc.neuronHistory = hc.neuronHistory.slice(-30);
    }

    // Keep only the last 30 days of daily data
    if (hc.daily && typeof hc.daily === 'object') {
      const dailyKeys = Object.keys(hc.daily).sort();
      if (dailyKeys.length > 30) {
        const keep = dailyKeys.slice(-30);
        const newDaily = {};
        keep.forEach(k => { newDaily[k] = hc.daily[k]; });
        hc.daily = newDaily;
      }
    }

    // Keep only the last 12 weeks of weekly data
    if (hc.weekly && typeof hc.weekly === 'object') {
      const weeklyKeys = Object.keys(hc.weekly).sort();
      if (weeklyKeys.length > 12) {
        const keep = weeklyKeys.slice(-12);
        const newWeekly = {};
        keep.forEach(k => { newWeekly[k] = hc.weekly[k]; });
        hc.weekly = newWeekly;
      }
    }

    // Keep only the last 6 months of monthly data
    if (hc.monthly && typeof hc.monthly === 'object') {
      const monthlyKeys = Object.keys(hc.monthly).sort();
      if (monthlyKeys.length > 6) {
        const keep = monthlyKeys.slice(-6);
        const newMonthly = {};
        keep.forEach(k => { newMonthly[k] = hc.monthly[k]; });
        hc.monthly = newMonthly;
      }
    }

    trimmed.hippocampus = hc;
  }

  return trimmed;
}

function migrateLegacyState() {
  const rawLegacy = typeof localStorage !== 'undefined' ? localStorage.getItem(LEGACY_NEURON_KEY) : null;
  const legacy = safeParse(rawLegacy);
  const next = clone(DEFAULT_BRAIN_STATE);
  if (Array.isArray(legacy)) {
    next.legacyNeuronas = legacy;
    next.neuronRegistry = legacy.map((n) => ({
      id: `legacy_${n.id || n.nombre || Math.random().toString(36).slice(2)}`,
      type: n.tipo === 'ingreso' ? 'income_fixed' : 'expense_discretionary',
      family: n.tipo === 'ingreso' ? 'flow' : 'habit',
      score: Number(n.peso || 0.5),
      confidence: 0.55,
      supportingEvidence: [{ source: 'legacy', legacyId: n.id, name: n.nombre, amount: n.monto }],
      lastActivatedAt: null
    }));
  }
  return next;
}

/**
 * Check IDB cache first (via window bridge set by main.js), then localStorage.
 */
export function loadFinanceBrainState() {
  if (typeof localStorage === 'undefined') return clone(DEFAULT_BRAIN_STATE);

  // Try IDB cache first (populated by main.js's mcBootstrapIdbCache)
  try {
    if (window.__mcIdbCache && window.__mcIdbCache.has(BRAIN_STORAGE_KEY)) {
      const parsed = safeParse(window.__mcIdbCache.get(BRAIN_STORAGE_KEY));
      if (parsed && parsed.version === 2) return normalizeBrainState(parsed);
    }
  } catch (_e) {}

  // Fallback to localStorage
  const raw = localStorage.getItem(BRAIN_STORAGE_KEY);
  const parsed = safeParse(raw);
  if (parsed && parsed.version === 2) return normalizeBrainState(parsed);

  const migrated = migrateLegacyState();
  saveFinanceBrainState(migrated);
  return migrated;
}

/**
 * Save brain state. Trims before saving to avoid QuotaExceededError.
 * Falls back to IDB cache bridge when localStorage is full.
 */
export function saveFinanceBrainState(state) {
  if (typeof localStorage === 'undefined') return;
  const normalized = normalizeBrainState(state);
  const trimmed = trimBrainState(normalized);
  const payload = JSON.stringify(trimmed);

  try {
    localStorage.setItem(BRAIN_STORAGE_KEY, payload);
  } catch (e) {
    // Quota exceeded — use IDB bridge exposed by main.js
    console.warn("Storage quota exceeded for Brain State, continuing in-memory:", e);
    try {
      if (window.__mcIdbCache && typeof window.__mcIdbPut === 'function') {
        window.__mcIdbCache.set(BRAIN_STORAGE_KEY, payload);
        window.__mcIdbPut(BRAIN_STORAGE_KEY, payload).catch(() => {});
        // Remove stale entry from localStorage to free space
        try { localStorage.removeItem(BRAIN_STORAGE_KEY); } catch (_e2) {}
      }
    } catch (_e3) {}
  }
}

export function upsertLegacyNeurona(neurona) {
  const state = loadFinanceBrainState();
  const next = Array.isArray(state.legacyNeuronas) ? [...state.legacyNeuronas] : [];
  const idx = next.findIndex((n) => n.id === neurona.id);
  if (idx >= 0) next[idx] = neurona;
  else next.push(neurona);
  state.legacyNeuronas = next;
  saveFinanceBrainState(state);
  return next;
}

export { BRAIN_STORAGE_KEY, LEGACY_NEURON_KEY, EPISODIC_MEMORY_KEY, DEFAULT_BRAIN_STATE };
