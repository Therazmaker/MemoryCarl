/**
 * temporal.js — Capa temporal centralizada para neuronas e insights
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export const TEMPORAL_CONTEXTS = ["current", "recent", "past", "historical", "timeless"];
export const TEMPORAL_SOURCES = ["batch_import", "manual", "generated", "unknown"];
export const TEMPORAL_CONFIDENCE = ["low", "medium", "high"];

export const DEFAULT_TEMPORAL_CONFIG = {
  recencyBuckets: {
    currentDays: 3,
    recentDays: 30,
    pastDays: 180,
  },
  recencyWeights: {
    current: 1.0,
    recent: 0.8,
    past: 0.45,
    historical: 0.2,
    timeless: 0.65,
  },
};

function safeDate(input) {
  if (!input) return null;
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function classifyTemporalDistance(dateOrTimestamp, options = {}) {
  const cfg = { ...DEFAULT_TEMPORAL_CONFIG, ...(options.config || {}) };
  const now = safeDate(options.now) || new Date();
  const d = safeDate(dateOrTimestamp);
  if (!d) return { context: "timeless", days: null };
  const days = Math.max(0, Math.floor((now.getTime() - d.getTime()) / DAY_MS));
  if (days <= cfg.recencyBuckets.currentDays) return { context: "current", days };
  if (days <= cfg.recencyBuckets.recentDays) return { context: "recent", days };
  if (days <= cfg.recencyBuckets.pastDays) return { context: "past", days };
  return { context: "historical", days };
}

export function inferTimeContext(dateOrTimestamp, options = {}) {
  if (!dateOrTimestamp) return options.defaultContext || "timeless";
  return classifyTemporalDistance(dateOrTimestamp, options).context;
}

export function computeRecencyWeight(dateOrTimestamp, options = {}) {
  const cfg = { ...DEFAULT_TEMPORAL_CONFIG, ...(options.config || {}) };
  const context = inferTimeContext(dateOrTimestamp, { ...options, config: cfg });
  return Number(cfg.recencyWeights[context] ?? cfg.recencyWeights.timeless ?? 0.65);
}

function normalizeDateOnly(v) {
  if (!v) return undefined;
  const s = String(v).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const d = safeDate(`${s}T00:00:00.000Z`);
  return d ? s : undefined;
}

function normalizeTimestamp(v) {
  const d = safeDate(v);
  return d ? d.toISOString() : undefined;
}

export function normalizeTemporalMeta(input, options = {}) {
  const src = (input && typeof input === "object") ? input : {};
  const date = normalizeDateOnly(src.date);
  const timestamp = normalizeTimestamp(src.timestamp || src.date);
  const sourcePeriod = src.sourcePeriod && typeof src.sourcePeriod === "object"
    ? {
        ...(normalizeDateOnly(src.sourcePeriod.start) ? { start: normalizeDateOnly(src.sourcePeriod.start) } : {}),
        ...(normalizeDateOnly(src.sourcePeriod.end) ? { end: normalizeDateOnly(src.sourcePeriod.end) } : {}),
      }
    : undefined;

  const dateRef = timestamp || (date ? `${date}T00:00:00.000Z` : null);
  const inferredContext = inferTimeContext(dateRef, options);
  const cleanContext = TEMPORAL_CONTEXTS.includes(src.timeContext) ? src.timeContext : inferredContext;
  const normalizedHistorical = typeof src.isHistorical === "boolean" ? src.isHistorical : undefined;
  const isPast = typeof src.isPast === "boolean"
    ? src.isPast
    : (["past", "historical"].includes(cleanContext));
  const recencyWeight = computeRecencyWeight(dateRef, options);
  const stage = src.stage ? String(src.stage).trim().slice(0, 80) : null;
  const source = TEMPORAL_SOURCES.includes(src.source) ? src.source : "unknown";
  const confidence = TEMPORAL_CONFIDENCE.includes(src.confidence) ? src.confidence : undefined;
  const isHistorical = typeof normalizedHistorical === "boolean"
    ? normalizedHistorical
    : (cleanContext === "historical" || isPast);

  return {
    isHistorical,
    date: date || null,
    stage,
    source,
    ...(confidence ? { confidence } : {}),
    ...(timestamp ? { timestamp } : {}),
    timeContext: cleanContext,
    isPast,
    recencyWeight,
    ...(sourcePeriod && (sourcePeriod.start || sourcePeriod.end) ? { sourcePeriod } : {}),
  };
}

function toTemporal(neuron) {
  return neuron?.temporal && typeof neuron.temporal === "object" ? neuron.temporal : {};
}

export function isHistoricalNeuron(neuron) {
  const t = toTemporal(neuron);
  return t.timeContext === "historical" || t.isPast === true && !["current", "recent"].includes(t.timeContext);
}

export function isRecentNeuron(neuron, options = {}) {
  const t = toTemporal(neuron);
  if (["current", "recent"].includes(t.timeContext)) return true;
  if (!t.timestamp && !t.date) return false;
  const context = inferTimeContext(t.timestamp || t.date, options);
  return context === "current" || context === "recent";
}

export function compareNeuronRecency(a, b) {
  const wa = Number(a?.temporal?.recencyWeight ?? 0.65);
  const wb = Number(b?.temporal?.recencyWeight ?? 0.65);
  if (wb !== wa) return wb - wa;
  const ad = safeDate(a?.temporal?.timestamp || a?.temporal?.date || a?.updatedAt || a?.createdAt)?.getTime() || 0;
  const bd = safeDate(b?.temporal?.timestamp || b?.temporal?.date || b?.updatedAt || b?.createdAt)?.getTime() || 0;
  return bd - ad;
}

export function summarizeTemporalRange(neurons = []) {
  const valid = (neurons || []).filter(Boolean);
  if (!valid.length) return { count: 0, byContext: {}, stageSignals: [], range: null };
  const byContext = {};
  const stageCount = new Map();
  let min = null;
  let max = null;
  for (const n of valid) {
    const t = n.temporal || {};
    const ctx = t.timeContext || "timeless";
    byContext[ctx] = (byContext[ctx] || 0) + 1;
    if (t.stage) stageCount.set(t.stage, (stageCount.get(t.stage) || 0) + 1);
    const d = safeDate(t.timestamp || t.date);
    if (!d) continue;
    if (!min || d < min) min = d;
    if (!max || d > max) max = d;
  }
  const stageSignals = [...stageCount.entries()].sort((a, b) => b[1] - a[1]).map(([stage, count]) => ({ stage, count }));
  return {
    count: valid.length,
    byContext,
    stageSignals,
    range: min && max ? { start: min.toISOString().slice(0, 10), end: max.toISOString().slice(0, 10) } : null,
  };
}
