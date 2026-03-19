/**
 * insightHistory.js — Historial ligero de insights para recurrencia y tendencia
 */

const INSIGHT_HISTORY_KEY = "memorycarl_neurochat_insight_history";
const DEFAULT_MAX = 80;

function safeRead() {
  try {
    const raw = localStorage.getItem(INSIGHT_HISTORY_KEY);
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch (_e) {
    return [];
  }
}

function safeWrite(history) {
  try {
    localStorage.setItem(INSIGHT_HISTORY_KEY, JSON.stringify(history));
  } catch (_e) {}
}

function compactInsight(insight, meta = {}) {
  return {
    id: insight.id,
    type: insight.type,
    title: insight.title,
    summary: insight.summary,
    confidence: insight.confidence,
    domains: insight.domains || [],
    basedOnNeurons: insight.basedOnNeurons || [],
    dominantConcepts: insight.signals?.dominantConcepts || [],
    patternFormula: insight.pattern?.formula || "",
    createdAt: insight.createdAt || new Date().toISOString(),
    batchAt: meta.batchAt || new Date().toISOString(),
  };
}

export function getInsightHistory(options = {}) {
  const max = options.maxHistory || DEFAULT_MAX;
  const history = safeRead();
  return history.slice(-max);
}

export function saveInsightBatch(insights = [], meta = {}) {
  if (!Array.isArray(insights) || insights.length === 0) return 0;
  const max = meta.maxHistory || DEFAULT_MAX;
  const current = safeRead();
  const incoming = insights.map((i) => compactInsight(i, meta));
  const next = [...current, ...incoming].slice(-max);
  safeWrite(next);
  return incoming.length;
}

function jaccard(a = [], b = []) {
  const as = new Set(a);
  const bs = new Set(b);
  const inter = [...as].filter((x) => bs.has(x)).length;
  const union = new Set([...as, ...bs]).size;
  return union === 0 ? 0 : inter / union;
}

export function computeInsightRecurrence(candidate, history = []) {
  if (!candidate || !Array.isArray(history) || history.length === 0) return 0;
  const recent = history.slice(-20);
  let best = 0;
  for (const h of recent) {
    const byType = h.type === candidate.type ? 0.4 : 0;
    const byNeurons = jaccard(h.basedOnNeurons || [], candidate.basedOnNeurons || []);
    const byConcepts = jaccard(h.dominantConcepts || [], candidate.signals?.dominantConcepts || []);
    best = Math.max(best, byType + byNeurons * 0.35 + byConcepts * 0.25);
  }
  return Number(Math.max(0, Math.min(1, best)).toFixed(2));
}

export function findRecentSimilarInsights(insights = [], options = {}) {
  const history = options.history || getInsightHistory(options);
  const minSimilarity = options.minSimilarity || 0.6;
  return insights.map((i) => {
    const recurrenceScore = computeInsightRecurrence(i, history);
    return {
      insightId: i.id,
      recurrenceScore,
      isRecurrent: recurrenceScore >= minSimilarity,
    };
  });
}

export function summarizeInsightTrend(history = [], options = {}) {
  const recent = history.slice(-(options.window || 15));
  if (!recent.length) return { summary: "Sin tendencia aún.", recurrentTypes: [], dominantDomain: null };

  const typeCount = new Map();
  const domainCount = new Map();
  for (const h of recent) {
    typeCount.set(h.type, (typeCount.get(h.type) || 0) + 1);
    for (const d of h.domains || []) domainCount.set(d, (domainCount.get(d) || 0) + 1);
  }

  const recurrentTypes = [...typeCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const dominantDomain = [...domainCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    summary: recurrentTypes.length
      ? `Se repite ${recurrentTypes[0]} en sesiones recientes.`
      : "La señal reciente es variable, sin patrón dominante estable.",
    recurrentTypes,
    dominantDomain,
  };
}
