/**
 * dedup.js — Anti-duplicados y fusión de neuronas
 * NeuroChat / MemoryCarl
 *
 * Antes de persistir neuronas generadas, decide si:
 *   - save_new     (score < 0.70)
 *   - merge_existing (score >= 0.85, o 0.70–0.84 con heurística)
 *   - discard       (score >= 0.85 pero el candidato no aporta nada nuevo)
 */

import { cosineSimilarity } from "./embeddings.js";
import { tokenize, keywordOverlap, clamp } from "./utils.js";

// ---- Umbrales configurables ----
const THRESHOLD_MERGE  = 0.80;
const THRESHOLD_REVIEW = 0.55;

// Peso de cada señal en el score de afinidad
// (el embedding es un bonus cuando está disponible; la similitud textual es el núcleo)
const WEIGHTS = {
  concept:   0.35,
  summary:   0.25,
  triggers:  0.25,
  embedding: 0.10,
  domain:    0.03,
  emotion:   0.02,
};

// ---- Helpers ----

/**
 * Similitud de string simple usando token overlap (Jaccard-like).
 * @param {string} a
 * @param {string} b
 * @returns {number} [0, 1]
 */
function stringSim(a, b) {
  const tA = tokenize(a || "");
  const tB = tokenize(b || "");
  if (!tA.length && !tB.length) return 1;
  if (!tA.length || !tB.length) return 0;
  const setB = new Set(tB);
  const intersection = tA.filter((t) => setB.has(t)).length;
  const union = new Set([...tA, ...tB]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Jaccard overlap entre dos arrays de strings.
 * @param {string[]} arrA
 * @param {string[]} arrB
 * @returns {number}
 */
function arrayJaccard(arrA, arrB) {
  if (!arrA.length && !arrB.length) return 1;
  if (!arrA.length || !arrB.length) return 0;
  const setA = new Set(arrA.map((s) => s.toLowerCase()));
  const setB = new Set(arrB.map((s) => s.toLowerCase()));
  let inter = 0;
  for (const x of setA) { if (setB.has(x)) inter++; }
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : inter / union;
}

// ---- API pública ----

/**
 * Compara un candidato con una neurona existente y devuelve score de afinidad.
 *
 * @param {Neuron} candidate
 * @param {Neuron} existingNeuron
 * @param {{ weights?: object }} [options]
 * @returns {{ score: number, breakdown: object }}
 */
export function compareNeuronCandidate(candidate, existingNeuron, options = {}) {
  const w = { ...WEIGHTS, ...(options.weights || {}) };

  const conceptSim = stringSim(
    candidate.core?.concept || "",
    existingNeuron.core?.concept || ""
  );
  const summarySim = stringSim(
    candidate.core?.summary || "",
    existingNeuron.core?.summary || ""
  );
  const triggersSim = arrayJaccard(
    candidate.triggers || [],
    existingNeuron.triggers || []
  );

  // Embedding similarity (cosine, mapped to [0,1])
  let embSim = 0;
  const cEmb = candidate.embedding;
  const eEmb = existingNeuron.embedding;
  if (Array.isArray(cEmb) && cEmb.length > 0 && Array.isArray(eEmb) && eEmb.length > 0) {
    embSim = cosineSimilarity(cEmb, eEmb);
  }

  // Domain match (exact or prefix)
  const domainScore = (
    (candidate.core?.domain || "").toLowerCase() ===
    (existingNeuron.core?.domain || "").toLowerCase()
  ) ? 1 : 0;

  // Emotion compatibility (same → 1, related → 0.5, different → 0)
  const emotionScore = candidate.emotion === existingNeuron.emotion ? 1 : 0.2;

  const score = clamp(
    conceptSim   * w.concept +
    summarySim   * w.summary +
    triggersSim  * w.triggers +
    embSim       * w.embedding +
    domainScore  * w.domain +
    emotionScore * w.emotion,
    0, 1
  );

  return {
    score,
    breakdown: { conceptSim, summarySim, triggersSim, embSim, domainScore, emotionScore },
  };
}

/**
 * Encuentra la mejor neurona existente para un candidato.
 *
 * @param {Neuron} candidate
 * @param {Neuron[]} existingNeurons
 * @param {object} [options]
 * @returns {{ neuron: Neuron, score: number, breakdown: object } | null}
 */
export function findBestNeuronMatch(candidate, existingNeurons, options = {}) {
  if (!Array.isArray(existingNeurons) || !existingNeurons.length) return null;

  let best = null;
  let bestScore = -1;

  for (const n of existingNeurons) {
    if (n.id === candidate.id) continue;
    if (n.feedbackStats?.removed) continue;
    const { score, breakdown } = compareNeuronCandidate(candidate, n, options);
    if (score > bestScore) {
      bestScore = score;
      best = { neuron: n, score, breakdown };
    }
  }

  return best;
}

/**
 * Decide si un candidato debe fusionarse con alguna neurona existente.
 *
 * @param {Neuron} candidate
 * @param {Neuron[]} existingNeurons
 * @param {object} [options]
 * @returns {{ action: string, matchId: string|null, score: number, reasons: string[] }}
 */
export function shouldMergeNeuron(candidate, existingNeurons, options = {}) {
  const mergeThreshold  = options.mergeThreshold  ?? THRESHOLD_MERGE;
  const reviewThreshold = options.reviewThreshold ?? THRESHOLD_REVIEW;

  const match = findBestNeuronMatch(candidate, existingNeurons, options);

  if (!match) {
    return { action: "save_new", matchId: null, score: 0, reasons: ["sin coincidencia existente"] };
  }

  const { neuron, score, breakdown } = match;
  const reasons = [];

  if (score >= mergeThreshold) {
    reasons.push(`score alto (${score.toFixed(3)})`);
    if (breakdown.conceptSim > 0.7) reasons.push("concepto muy similar");
    if (breakdown.triggersSim > 0.5) reasons.push("triggers solapados");

    // Discard si el candidato no añade información nueva (summary/triggers idénticos)
    const sameSummary = stringSim(
      candidate.core?.summary || "",
      neuron.core?.summary || ""
    ) > 0.92;
    const sameTriggersAlmost = breakdown.triggersSim > 0.90;
    if (sameSummary && sameTriggersAlmost) {
      reasons.push("contenido prácticamente idéntico → discard");
      return { action: "discard", matchId: neuron.id, score, reasons };
    }

    return { action: "merge_existing", matchId: neuron.id, score, reasons };
  }

  if (score >= reviewThreshold) {
    // Zona de revisión: aplicar heurística de dominio + triggers
    const sameDomain   = breakdown.domainScore === 1;
    const goodTriggers = breakdown.triggersSim > 0.35;
    if (sameDomain && goodTriggers) {
      reasons.push(`score medio (${score.toFixed(3)}) + mismo dominio + triggers solapados → merge`);
      return { action: "merge_existing", matchId: neuron.id, score, reasons };
    }
    reasons.push(`score medio (${score.toFixed(3)}) → save_new por dominio o triggers insuficientes`);
    return { action: "save_new", matchId: null, score, reasons };
  }

  reasons.push(`score bajo (${score.toFixed(3)}) → concepto nuevo`);
  return { action: "save_new", matchId: null, score, reasons };
}

/**
 * Fusiona un candidato en una neurona base (existente).
 * Preserva el id de la neurona existente.
 *
 * @param {Neuron} baseNeuron  — neurona existente a actualizar
 * @param {Neuron} candidateNeuron — candidato con información nueva
 * @returns {Neuron}
 */
export function mergeNeuronData(baseNeuron, candidateNeuron) {
  const now = new Date().toISOString();

  // Combinar evidencia sin duplicados
  const evidence = [
    ...(baseNeuron.evidence || []),
    ...(candidateNeuron.evidence || []),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i).slice(0, 20);

  // Combinar triggers sin duplicados (normalizar a lowercase para comparar)
  const seenTriggers = new Set((baseNeuron.triggers || []).map((t) => t.toLowerCase()));
  const mergedTriggers = [...(baseNeuron.triggers || [])];
  for (const t of candidateNeuron.triggers || []) {
    if (t && !seenTriggers.has(t.toLowerCase())) {
      seenTriggers.add(t.toLowerCase());
      mergedTriggers.push(t);
    }
  }

  // Combinar connections sin duplicados
  const seenConn = new Set(baseNeuron.connections || []);
  const mergedConn = [...(baseNeuron.connections || [])];
  for (const c of candidateNeuron.connections || []) {
    if (c && c !== baseNeuron.id && !seenConn.has(c)) {
      seenConn.add(c);
      mergedConn.push(c);
    }
  }

  // Enriquecer summary si el candidato aporta información nueva
  const baseSummary = baseNeuron.core?.summary || "";
  const candSummary = candidateNeuron.core?.summary || "";
  let finalSummary = baseSummary;
  if (candSummary && stringSim(baseSummary, candSummary) < 0.60) {
    // El candidato tiene información significativamente diferente → combinar
    finalSummary = baseSummary
      ? `${baseSummary} / ${candSummary}`.slice(0, 500)
      : candSummary.slice(0, 500);
  }

  // Incrementar weight moderadamente (clamp a [0, 1])
  const newWeight = clamp((baseNeuron.weight || 0.5) + 0.05, 0, 1);

  return {
    ...baseNeuron,
    core: {
      ...baseNeuron.core,
      summary: finalSummary,
    },
    triggers:    mergedTriggers.slice(0, 20),
    connections: mergedConn.slice(0, 30),
    evidence,
    weight:    newWeight,
    updatedAt: now,
  };
}

/**
 * Deduplica un lote de candidatos contra neuronas existentes
 * y entre sí mismos.
 *
 * @param {Neuron[]} candidates
 * @param {Neuron[]} existingNeurons
 * @param {object} [options]
 * @returns {{
 *   toSave: Neuron[],
 *   toMerge: Array<{ targetId: string, mergedNeuron: Neuron, sourceCandidate: Neuron, decision: object }>,
 *   discarded: Neuron[]
 * }}
 */
export function dedupeGeneratedNeurons(candidates, existingNeurons, options = {}) {
  const toSave     = [];
  const toMerge    = [];
  const discarded  = [];

  // Map para rastrear merges ya programados (targetId → mergedNeuron)
  const mergeMap = new Map();

  // Para dedup intra-lote: neuronas ya comprometidas a save_new
  const batchSaved = [];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;

    // 1. Comparar contra neuronas existentes
    const decision = shouldMergeNeuron(candidate, existingNeurons, options);

    if (decision.action === "discard") {
      discarded.push(candidate);
      continue;
    }

    if (decision.action === "merge_existing") {
      const targetId = decision.matchId;
      // Obtener la versión más actualizada de la neurona target (puede haber sido mergeada antes)
      const baseNeuron =
        mergeMap.get(targetId)?.mergedNeuron ||
        existingNeurons.find((n) => n.id === targetId);

      if (!baseNeuron) {
        // Target ya no existe; salvar como nuevo
        toSave.push(candidate);
        batchSaved.push(candidate);
        continue;
      }

      const merged = mergeNeuronData(baseNeuron, candidate);
      mergeMap.set(targetId, { targetId, mergedNeuron: merged, sourceCandidate: candidate, decision });
      continue;
    }

    // action === "save_new": verificar dedup dentro del mismo lote
    const inBatchMatch = findBestNeuronMatch(candidate, batchSaved, options);
    if (inBatchMatch && inBatchMatch.score >= (options.mergeThreshold ?? THRESHOLD_MERGE)) {
      // Muy similar a otro candidato del mismo lote → descartar para evitar duplicados en lote
      discarded.push(candidate);
      continue;
    }

    toSave.push(candidate);
    batchSaved.push(candidate);
  }

  // Construir lista de merges desde el map
  for (const entry of mergeMap.values()) {
    toMerge.push(entry);
  }

  return { toSave, toMerge, discarded };
}
