/**
 * insightSynthesis.js — Construcción, scoring y compresión de insights listos para UI/contexto
 */

const INSIGHT_TYPES = new Set([
  "dominant_pattern", "tension", "trend", "contradiction", "anchor",
  "relationship_context", "work_context", "identity_signal", "emerging_pattern",
  "current_pattern", "past_pattern", "recurring_pattern", "resolved_pattern", "stage_pattern",
]);

function uniq(arr = []) { return [...new Set(arr.filter(Boolean))]; }

function normalizeInsightType(type) {
  return INSIGHT_TYPES.has(type) ? type : "dominant_pattern";
}

function baseTitleByType(type) {
  const map = {
    dominant_pattern: "Patrón dominante",
    tension: "Tensión operativa",
    contradiction: "Contradicción activa",
    anchor: "Ancla estable",
    work_context: "Contexto de trabajo",
    relationship_context: "Contexto relacional",
    emerging_pattern: "Patrón emergente",
    trend: "Tendencia",
    identity_signal: "Señal identitaria",
    current_pattern: "Patrón actual",
    past_pattern: "Patrón pasado",
    recurring_pattern: "Patrón recurrente",
    resolved_pattern: "Patrón resuelto",
    stage_pattern: "Patrón por etapa",
  };
  return map[type] || "Insight";
}

function composeSummary(pattern, mode = "default") {
  const prefix = mode === "objective" ? "Lo que aparece aquí es" : "Lo que aparece es";
  if (pattern.type === "dominant_pattern") return `${prefix} un patrón de ${pattern.description.toLowerCase()}`;
  if (pattern.type === "tension") return `La tensión está entre impulso y estructura: ${pattern.description}`;
  if (pattern.type === "contradiction") return `Hay una contradicción operativa: ${pattern.description}`;
  if (pattern.type === "emerging_pattern") return `Esto sugiere repetición reciente: ${pattern.description}`;
  if (pattern.type === "resolved_pattern") return `Se observa evolución: ${pattern.description}`;
  if (pattern.type === "recurring_pattern") return `Hay recurrencia entre etapas: ${pattern.description}`;
  return pattern.description || "Se detectó una señal consistente en las neuronas activadas.";
}

export function validateInsight(insight) {
  if (!insight || typeof insight !== "object") return false;
  if (typeof insight.id !== "string" || !insight.id) return false;
  if (typeof insight.title !== "string" || insight.title.trim().length < 3) return false;
  if (typeof insight.summary !== "string" || insight.summary.trim().length < 12) return false;
  if (typeof insight.confidence !== "number" || insight.confidence < 0 || insight.confidence > 1) return false;
  if (!INSIGHT_TYPES.has(insight.type)) return false;
  return true;
}

export function scoreInsightCandidate(candidate, options = {}) {
  const mode = options.interpretationMode || "default";
  let score = Number(candidate.confidence || 0);
  score += Math.min(0.2, (candidate.signals?.recurrenceScore || 0) * 0.2);
  score += Math.min(0.12, ((candidate.basedOnNeurons || []).length / 10) * 0.12);
  if (mode === "objective" && ["dominant_pattern", "contradiction", "trend", "emerging_pattern", "resolved_pattern", "recurring_pattern"].includes(candidate.type)) score += 0.12;
  if (mode === "objective" && ["anchor", "relationship_context"].includes(candidate.type)) score -= 0.06;
  return Number(Math.max(0, Math.min(1, score)).toFixed(3));
}

export function rankInsights(insights = [], options = {}) {
  return [...insights]
    .map((i) => ({ ...i, rankingScore: scoreInsightCandidate(i, options) }))
    .sort((a, b) => (b.rankingScore || 0) - (a.rankingScore || 0));
}

function similarityByNeuronBase(a, b) {
  const as = new Set(a.basedOnNeurons || []);
  const bs = new Set(b.basedOnNeurons || []);
  const inter = [...as].filter((x) => bs.has(x)).length;
  return inter / Math.max(1, Math.min(as.size, bs.size));
}

export function compressInsights(insights = [], options = {}) {
  const threshold = options.similarityThreshold ?? 0.65;
  const out = [];
  for (const insight of insights) {
    const near = out.find((existing) => similarityByNeuronBase(existing, insight) >= threshold || existing.type === insight.type);
    if (!near) {
      out.push(insight);
      continue;
    }
    if ((insight.rankingScore || insight.confidence) > (near.rankingScore || near.confidence)) {
      near.title = insight.title;
      near.summary = insight.summary;
      near.confidence = insight.confidence;
      near.type = insight.type;
    }
    near.basedOnNeurons = uniq([...(near.basedOnNeurons || []), ...(insight.basedOnNeurons || [])]);
    near.signals = {
      ...near.signals,
      ...insight.signals,
      dominantConcepts: uniq([...(near.signals?.dominantConcepts || []), ...(insight.signals?.dominantConcepts || [])]).slice(0, 6),
    };
  }
  return out;
}

export function synthesizeInsights({ activated = [], clusters = [], patterns = [], contextEntities = [], options = {} } = {}) {
  if (!Array.isArray(patterns) || patterns.length === 0) return [];
  const mode = options.interpretationMode || "default";

  const generated = patterns.map((pattern, idx) => {
    const cluster = clusters.find((c) => c.id === pattern.clusterId) || clusters[0] || null;
    const type = normalizeInsightType(pattern.type);
    const recurrenceScore = Number(pattern.recurrenceScore || 0);
    const dominantConcepts = uniq([...(pattern.dominantConcepts || []), ...(cluster?.dominantConcepts || [])]).slice(0, 6);
    const manualEntities = uniq([...(contextEntities || []), ...(pattern.manualEntities || []), ...(cluster?.manualEntities || [])]).slice(0, 4);

    const insight = {
      id: `ins_${Date.now().toString(36)}_${idx}`,
      type,
      title: baseTitleByType(type),
      summary: composeSummary(pattern, mode),
      confidence: Number(Math.max(0.2, Math.min(0.98, pattern.confidence || 0.5)).toFixed(2)),
      domains: uniq(pattern.domains || cluster?.domains || activated.map((a) => a.neuron?.core?.domain || a.core?.domain)).filter(Boolean).slice(0, 3),
      emotion: pattern.emotion || cluster?.emotion || null,
      basedOnNeurons: uniq(pattern.basedOnNeurons || cluster?.neuronIds || activated.map((a) => (a.neuron || a).id)).slice(0, 12),
      signals: {
        dominantConcepts,
        repeatedTriggers: dominantConcepts.slice(0, 3),
        manualEntities,
        timeWeight: Number(((cluster?.weight || 0.4) * 0.8).toFixed(2)),
        recurrenceScore,
      },
      pattern: {
        formula: pattern.formula || "señales activas -> lectura",
        description: pattern.description || "Lectura sintetizada desde señales activadas.",
      },
      tone: pattern.tone || (mode === "objective" ? "observational" : "reflective"),
      createdAt: new Date().toISOString(),
    };

    return insight;
  }).filter((i) => validateInsight(i));

  const ranked = rankInsights(generated, options);
  const compressed = compressInsights(ranked, options);
  const maxInsights = Math.max(1, Math.min(3, options.maxInsights || 3));

  return compressed
    .filter((i) => i.confidence >= (options.minConfidence || 0.42))
    .slice(0, maxInsights)
    .map(({ rankingScore, ...rest }) => rest);
}
