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

export function loadFinanceBrainState() {
  if (typeof localStorage === 'undefined') return clone(DEFAULT_BRAIN_STATE);
  const raw = localStorage.getItem(BRAIN_STORAGE_KEY);
  const parsed = safeParse(raw);
  if (parsed && parsed.version === 2) return normalizeBrainState(parsed);

  const migrated = migrateLegacyState();
  saveFinanceBrainState(migrated);
  return migrated;
}

export function saveFinanceBrainState(state) {
  if (typeof localStorage === 'undefined') return;
  const normalized = normalizeBrainState(state);
  try {
    localStorage.setItem(BRAIN_STORAGE_KEY, JSON.stringify(normalized));
  } catch (e) {
    console.warn("Storage quota exceeded for Brain State, continuing in-memory:", e);
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
