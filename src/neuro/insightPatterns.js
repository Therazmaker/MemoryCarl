/**
 * insightPatterns.js — Heurísticas de clustering y detección de patrones de insight
 */

const BLOCK_WORDS = ["bloqueo", "bloqueado", "traba", "parálisis", "paralisis", "no se por donde empezar", "no sé por dónde empezar", "dispersión", "dispersion"];
const OVERLOAD_WORDS = ["saturación", "saturacion", "sobrecarga", "demasiado", "muchas tareas", "frentes", "urgencia"];
const INTENT_WORDS = ["quiero", "quieres", "avanzar", "empezar", "resolver", "ordenar", "enfoque"];
const WORK_WORDS = ["trabajo", "proyecto", "entrega", "deadline", "equipo"];

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

function tokenizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length >= 3);
}

function getNeuronTokens(activatedEntry) {
  const n = activatedEntry?.neuron || activatedEntry || {};
  const parts = [n.core?.concept, n.core?.summary, ...(n.triggers || []), ...(n.meta?.aliases || [])].join(" ");
  return tokenizeText(parts);
}

function topTerms(entries, limit = 5) {
  const freq = new Map();
  for (const e of entries) {
    for (const t of getNeuronTokens(e)) freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k]) => k);
}

function scoreEntry(e) {
  const neuronWeight = Number(e?.neuron?.weight ?? e?.weight ?? 0.5);
  return Number(e?.score ?? 0.25) * 0.7 + neuronWeight * 0.3;
}

export function buildInsightClusters(activated = [], _allNeurons = [], options = {}) {
  return clusterActivatedNeurons(activated, options);
}

export function clusterActivatedNeurons(activated = [], options = {}) {
  if (!Array.isArray(activated) || activated.length === 0) return [];

  const buckets = new Map();
  const addToBucket = (key, entry) => {
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(entry);
  };

  for (const entry of activated) {
    const n = entry.neuron || entry;
    const domain = String(n.core?.domain || "general").toLowerCase();
    const emotion = String(n.emotion || "neutral").toLowerCase();
    const manualFlag = n.source?.kind === "manual" ? "manual" : "auto";
    const key = `${domain}|${emotion}|${manualFlag}`;
    addToBucket(key, entry);

    for (const conn of n.connections || []) {
      if ((activated.find((a) => (a.neuron || a).id === conn))) {
        addToBucket(`conn:${[n.id, conn].sort().join("_")}`, entry);
      }
    }
  }

  const maxClusters = options.maxClusters || 6;
  const clusters = [...buckets.entries()].map(([key, entries], idx) => {
    const neurons = entries.map((e) => e.neuron || e);
    const domains = uniq(neurons.map((n) => n.core?.domain).filter(Boolean));
    const emotions = uniq(neurons.map((n) => n.emotion || "neutral"));
    const manualEntities = uniq(neurons.filter((n) => n.source?.kind === "manual").map((n) => n.core?.concept));
    const dominantConcepts = topTerms(entries, 5);
    const weight = entries.reduce((acc, e) => acc + scoreEntry(e), 0) / entries.length;
    const baseLabel = `${domains[0] || "general"} + ${dominantConcepts[0] || "señal"}`;

    return {
      id: `cluster_${String(idx + 1).padStart(3, "0")}`,
      key,
      label: baseLabel,
      domains,
      emotion: emotions[0] || "neutral",
      neuronIds: uniq(neurons.map((n) => n.id)),
      weight: Number(weight.toFixed(3)),
      manualEntities,
      dominantConcepts,
      isManualHeavy: manualEntities.length > 0,
    };
  });

  return clusters
    .filter((c) => c.neuronIds.length > 0)
    .sort((a, b) => b.weight - a.weight || b.neuronIds.length - a.neuronIds.length)
    .slice(0, maxClusters);
}

function buildPattern(type, cluster, patch = {}) {
  return {
    type,
    confidence: patch.confidence ?? 0.5,
    clusterId: cluster?.id || null,
    domains: cluster?.domains || [],
    emotion: cluster?.emotion || null,
    basedOnNeurons: cluster?.neuronIds || [],
    dominantConcepts: cluster?.dominantConcepts || [],
    manualEntities: cluster?.manualEntities || [],
    ...patch,
  };
}

function hasAnyWord(terms = [], wordList = []) {
  const blob = ` ${terms.join(" ").toLowerCase()} `;
  return wordList.some((w) => blob.includes(` ${String(w).toLowerCase()} `));
}

function getTemporalStats(activated = []) {
  const byContext = new Map();
  const byStage = new Map();
  for (const e of activated) {
    const n = e.neuron || e;
    const t = n.temporal || {};
    const ctx = t.timeContext || "timeless";
    byContext.set(ctx, (byContext.get(ctx) || 0) + 1);
    if (t.stage) byStage.set(t.stage, (byStage.get(t.stage) || 0) + 1);
  }
  return { byContext, byStage };
}

export function detectDominantPattern(clusters = [], options = {}) {
  if (!clusters.length) return null;
  const c = clusters[0];
  const hasOverload = hasAnyWord(c.dominantConcepts, OVERLOAD_WORDS);
  const hasBlock = hasAnyWord(c.dominantConcepts, BLOCK_WORDS);

  let formula = `${c.dominantConcepts.slice(0, 2).join(" + ")} -> ${c.dominantConcepts[2] || "impacto"}`;
  let description = `El patrón dominante parece concentrarse en ${c.label}.`;
  let confidence = Math.min(0.95, 0.45 + c.weight * 0.45);

  if (hasOverload && hasBlock) {
    formula = "sobrecarga + dispersión -> bloqueo";
    description = "Cuando sube la carga y se abre demasiados frentes, aparece bloqueo de inicio.";
    confidence = Math.max(confidence, 0.78);
  }

  return buildPattern("dominant_pattern", c, {
    formula,
    description,
    confidence: Number(confidence.toFixed(2)),
    tone: options.interpretationMode === "objective" ? "observational" : "reflective",
  });
}

export function detectTensionPattern(clusters = [], _options = {}) {
  if (clusters.length < 1) return null;
  const primary = clusters[0];
  const aggregateTerms = clusters.flatMap((c) => c.dominantConcepts || []);
  const hasIntent = hasAnyWord(aggregateTerms, INTENT_WORDS);
  const hasBlock = hasAnyWord(aggregateTerms, BLOCK_WORDS) || hasAnyWord(aggregateTerms, OVERLOAD_WORDS);
  if (!hasIntent || !hasBlock) return null;

  return {
    type: "tension",
    confidence: Number(Math.min(0.9, 0.58 + primary.weight * 0.25).toFixed(2)),
    domains: primary.domains,
    emotion: primary.emotion,
    basedOnNeurons: uniq(clusters.slice(0, 2).flatMap((c) => c.neuronIds)),
    dominantConcepts: uniq(aggregateTerms).slice(0, 6),
    formula: "impulso de avance + sobrecarga -> fricción de ejecución",
    description: "Hay intención de avanzar, pero la estructura actual no absorbe el volumen y aparece tensión.",
    tone: "observational",
  };
}

export function detectContradictions(activated = [], _options = {}) {
  if (!activated.length) return null;
  const texts = activated.flatMap((e) => getNeuronTokens(e));
  const seeksCalm = texts.includes("calma") || texts.includes("orden");
  const urgency = texts.includes("urgencia") || texts.includes("apuro");
  if (!seeksCalm || !urgency) return null;

  const ids = uniq(activated.map((e) => (e.neuron || e).id));
  return {
    type: "contradiction",
    confidence: 0.66,
    basedOnNeurons: ids,
    domains: uniq(activated.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    emotion: null,
    dominantConcepts: ["calma", "urgencia"],
    formula: "búsqueda de calma + dinámica urgente -> contradicción operativa",
    description: "Se busca estabilidad, pero se sostienen dinámicas de urgencia que la debilitan.",
    tone: "cautionary",
  };
}

export function detectEmergingPattern(activated = [], insightHistory = [], _options = {}) {
  if (!activated.length || !Array.isArray(insightHistory) || insightHistory.length === 0) return null;
  const currentIds = new Set(activated.map((e) => (e.neuron || e).id));
  let bestOverlap = 0;
  for (const item of insightHistory.slice(-12)) {
    const base = new Set(item.basedOnNeurons || []);
    const overlap = [...base].filter((id) => currentIds.has(id)).length;
    bestOverlap = Math.max(bestOverlap, overlap / Math.max(1, base.size));
  }
  if (bestOverlap < 0.34) return null;

  return {
    type: "emerging_pattern",
    confidence: Number(Math.min(0.9, 0.45 + bestOverlap * 0.5).toFixed(2)),
    basedOnNeurons: [...currentIds],
    domains: uniq(activated.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    emotion: null,
    dominantConcepts: topTerms(activated, 5),
    formula: "señales repetidas en sesiones recientes -> patrón emergente",
    description: "Esta combinación no parece aislada; reaparece como forma de respuesta.",
    recurrenceScore: Number(bestOverlap.toFixed(2)),
    tone: "reflective",
  };
}

export function detectIdentityAnchors(activated = [], _options = {}) {
  const anchors = activated.filter((e) => {
    const n = e.neuron || e;
    return n.type === "identity" || n.type === "identity_anchor";
  });
  if (!anchors.length) return null;
  const ids = uniq(anchors.map((e) => (e.neuron || e).id));
  return {
    type: "anchor",
    confidence: 0.62,
    basedOnNeurons: ids,
    domains: uniq(anchors.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    emotion: anchors[0]?.neuron?.emotion || anchors[0]?.emotion || null,
    dominantConcepts: topTerms(anchors, 4),
    formula: "ancla identitaria + presión contextual -> estabilidad relativa",
    description: "Hay una base estable en cómo se procesa este tema, incluso con carga alrededor.",
    tone: "stabilizing",
  };
}

export function detectEntityContextPattern(activated = [], options = {}) {
  if (!activated.length) return null;
  const manual = activated.filter((e) => (e.neuron || e).source?.kind === "manual");
  if (!manual.length) return null;
  const entities = uniq(manual.map((e) => (e.neuron || e).core?.concept)).filter(Boolean);
  const allTerms = topTerms(activated, 8);
  const workSignal = hasAnyWord(allTerms, WORK_WORDS)
    || activated.some((e) => String((e.neuron || e).core?.domain || "").toLowerCase().includes("work"));

  return {
    type: workSignal ? "work_context" : "relationship_context",
    confidence: Number(Math.min(0.88, 0.52 + manual.length * 0.08).toFixed(2)),
    basedOnNeurons: uniq(activated.map((e) => (e.neuron || e).id)),
    domains: uniq(activated.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    emotion: null,
    dominantConcepts: allTerms,
    manualEntities: entities,
    formula: `${entities.slice(0, 2).join(" + ")} + contexto -> carga contextual`,
    description: workSignal
      ? "Cuando entra el contexto de trabajo con estas entidades, sube la carga y baja la claridad de ejecución."
      : "La combinación de entidades manuales está modulando el foco emocional del momento.",
    tone: options.interpretationMode === "objective" ? "observational" : "reflective",
  };
}

export function detectRecurringAcrossTime(activated = [], historicalMatches = [], _options = {}) {
  if (!activated.length || !historicalMatches.length) return null;
  const currentTerms = new Set(topTerms(activated, 8));
  const historicalTerms = new Set(topTerms(historicalMatches, 8));
  const overlap = [...currentTerms].filter((t) => historicalTerms.has(t));
  const ratio = overlap.length / Math.max(1, Math.min(currentTerms.size, historicalTerms.size));
  if (ratio < 0.28) return null;
  return {
    type: "recurring_pattern",
    confidence: Number(Math.min(0.92, 0.48 + ratio * 0.42).toFixed(2)),
    basedOnNeurons: uniq([...activated, ...historicalMatches].map((e) => (e.neuron || e).id)),
    domains: uniq(activated.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    dominantConcepts: overlap.slice(0, 6),
    formula: "señales similares entre pasado y presente -> recurrencia parcial",
    description: "Esto no es completamente nuevo; conserva trazas de un patrón previo.",
    recurrenceScore: Number(ratio.toFixed(2)),
    tone: "observational",
  };
}

export function detectResolvedPattern(neurons = [], options = {}) {
  const windowDays = options.recentWindowDays || 45;
  const now = new Date(options.now || Date.now());
  const historical = [];
  const recent = [];
  for (const e of neurons) {
    const n = e.neuron || e;
    const t = n.temporal || {};
    const ref = t.timestamp || t.date;
    if (!ref) continue;
    const days = Math.max(0, Math.floor((now.getTime() - new Date(ref).getTime()) / (24 * 3600 * 1000)));
    if (days <= windowDays) recent.push(e);
    else historical.push(e);
  }
  if (!historical.length || recent.length >= historical.length * 0.8) return null;
  return {
    type: "resolved_pattern",
    confidence: 0.62,
    basedOnNeurons: uniq(historical.map((e) => (e.neuron || e).id)),
    domains: uniq(historical.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    dominantConcepts: topTerms(historical, 5),
    formula: "alta presencia histórica + baja presencia reciente -> patrón posiblemente resuelto",
    description: "Este patrón fue fuerte en registros pasados, pero no parece dominante ahora.",
    tone: "observational",
  };
}

export function detectTrendPattern(neurons = [], options = {}) {
  const timed = neurons.filter((e) => {
    const n = e.neuron || e;
    return Boolean(n.temporal?.timestamp || n.temporal?.date);
  });
  if (timed.length < 3) return null;
  const sorted = [...timed].sort((a, b) => {
    const ad = new Date((a.neuron || a).temporal.timestamp || (a.neuron || a).temporal.date).getTime();
    const bd = new Date((b.neuron || b).temporal.timestamp || (b.neuron || b).temporal.date).getTime();
    return ad - bd;
  });
  const half = Math.floor(sorted.length / 2);
  const oldAvg = sorted.slice(0, half).reduce((acc, e) => acc + (e.score || 0.4), 0) / Math.max(1, half);
  const newAvg = sorted.slice(half).reduce((acc, e) => acc + (e.score || 0.4), 0) / Math.max(1, sorted.length - half);
  const delta = newAvg - oldAvg;
  let trend = "stable";
  if (delta > 0.1) trend = "up";
  if (delta < -0.1) trend = "down";
  return {
    type: "trend",
    confidence: 0.55,
    basedOnNeurons: uniq(sorted.map((e) => (e.neuron || e).id)),
    domains: uniq(sorted.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    dominantConcepts: topTerms(sorted, 5),
    formula: "comparación de intensidad temporal -> tendencia",
    description: trend === "up" ? "La señal actual parece más intensa que en etapas anteriores."
      : trend === "down" ? "La señal actual parece más tenue que en el pasado."
      : "La señal se mantiene relativamente estable en el tiempo.",
    trendDirection: trend,
    tone: "observational",
  };
}

export function detectStagePattern(neurons = [], _options = {}) {
  const stats = getTemporalStats(neurons);
  const top = [...stats.byStage.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top || top[1] < 2) return null;
  return {
    type: "stage_pattern",
    confidence: 0.58,
    basedOnNeurons: uniq(neurons.map((e) => (e.neuron || e).id)),
    domains: uniq(neurons.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
    dominantConcepts: topTerms(neurons, 5),
    formula: "señales concentradas por etapa -> stage pattern",
    description: `Este tema aparece sobre todo en la etapa "${top[0]}".`,
    stage: top[0],
    tone: "observational",
  };
}

export function detectTemporalPattern(activated = [], insightHistory = [], options = {}) {
  const stats = getTemporalStats(activated);
  const current = (stats.byContext.get("current") || 0) + (stats.byContext.get("recent") || 0);
  const historical = (stats.byContext.get("historical") || 0) + (stats.byContext.get("past") || 0);
  if (!current && !historical) return null;
  if (current >= historical * 1.4) {
    return {
      type: "current_pattern",
      confidence: 0.6,
      basedOnNeurons: uniq(activated.map((e) => (e.neuron || e).id)),
      domains: uniq(activated.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
      dominantConcepts: topTerms(activated, 5),
      formula: "predominio de señales recientes -> patrón actual",
      description: "La señal principal parece activa en el presente.",
      tone: "observational",
    };
  }
  if (historical > current * 1.2) {
    return {
      type: "past_pattern",
      confidence: 0.58,
      basedOnNeurons: uniq(activated.map((e) => (e.neuron || e).id)),
      domains: uniq(activated.map((e) => (e.neuron || e).core?.domain)).filter(Boolean),
      dominantConcepts: topTerms(activated, 5),
      formula: "predominio de señales históricas -> patrón pasado",
      description: "La mayor parte de la evidencia activada corresponde a contexto histórico.",
      tone: "observational",
    };
  }
  return detectRecurringAcrossTime(
    activated.filter((e) => ["current", "recent", "timeless"].includes((e.neuron || e).temporal?.timeContext || "timeless")),
    activated.filter((e) => ["past", "historical"].includes((e.neuron || e).temporal?.timeContext || "")),
    options,
  ) || detectEmergingPattern(activated, insightHistory, options);
}

export function detectInsightPatterns({ activated = [], clusters = [], insightHistory = [], options = {} } = {}) {
  const temporalPattern = detectTemporalPattern(activated, insightHistory, options);
  const recurring = detectRecurringAcrossTime(
    activated.filter((e) => ["current", "recent", "timeless"].includes((e.neuron || e).temporal?.timeContext || "timeless")),
    activated.filter((e) => ["past", "historical"].includes((e.neuron || e).temporal?.timeContext || "")),
    options,
  );
  const patterns = [
    detectDominantPattern(clusters, options),
    detectTensionPattern(clusters, options),
    detectContradictions(activated, options),
    detectIdentityAnchors(activated, options),
    detectEntityContextPattern(activated, options),
    temporalPattern,
    recurring,
    detectResolvedPattern(activated, options),
    detectTrendPattern(activated, options),
    detectStagePattern(activated, options),
    detectEmergingPattern(activated, insightHistory, options),
  ].filter(Boolean);

  return patterns.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}
