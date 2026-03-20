import { cosineSimilarity, getEmbedding } from "./embeddings.js";
import { clamp, keywordOverlap, tokenize } from "./utils.js";

const GENERIC_TRIGGERS = new Set([
  "vida", "cosas", "tema", "algo", "general", "normal", "todo", "nada", "situacion", "situación",
]);

const SCORE_WEIGHTS = {
  semantic: 0.40,
  keyword: 0.20,
  weight: 0.10,
  recency: 0.10,
  feedback: 0.10,
  triggerQuality: 0.10,
};

const STOPWORDS = new Set([
  "de", "la", "el", "y", "en", "que", "un", "una", "mi", "me", "hoy", "tuve", "algo", "muy", "con", "por", "para",
]);

function normalizeText(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
}

function normalizeFeedbackScore(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return clamp((num + 0.08) / 0.16, 0, 1);
}

function normalizeTriggerQuality(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0.5;
  return clamp((num + 1) / 2, 0, 1);
}

export function isGenericTrigger(word) {
  const normalized = normalizeText(word);
  if (!normalized) return true;
  return GENERIC_TRIGGERS.has(normalized) || normalized.length <= 3;
}

export function evaluateTriggerQuality(neuron, userInput = "") {
  const triggers = Array.isArray(neuron?.triggers) ? neuron.triggers.filter(Boolean) : [];
  const normalizedInput = normalizeText(userInput);

  let score = 0;
  if (triggers.length === 0) score = -0.4;
  else if (triggers.length === 1) score = -0.2;
  else if (triggers.length >= 4) score = 0.1;

  const genericCount = triggers.reduce((acc, trigger) => (isGenericTrigger(trigger) ? acc + 1 : acc), 0);
  if (genericCount > 0) score -= 0.1;

  if (normalizedInput) {
    const aligned = triggers.some((trigger) => {
      const normalizedTrigger = normalizeText(trigger);
      return normalizedTrigger && normalizedInput.includes(normalizedTrigger);
    });
    if (aligned) score += 0.1;
  }

  return clamp(score, -1, 1);
}

export function computeFinalNeuronScore(entry, userInput = "") {
  const semantic = clamp(Number(entry?.components?.semantic) || 0, 0, 1);
  const keyword = clamp(Number(entry?.components?.keyword) || 0, 0, 1);
  const weight = clamp(Number(entry?.components?.weight) || Number(entry?.neuron?.weight) || 0, 0, 1);
  const recency = clamp(Number(entry?.components?.recency) || 0, 0, 1);
  const feedbackScore = normalizeFeedbackScore(entry?.components?.neuronFeedbackBoost);
  const triggerQualityRaw = evaluateTriggerQuality(entry?.neuron, userInput);
  const triggerQuality = normalizeTriggerQuality(triggerQualityRaw);

  const score =
    semantic * SCORE_WEIGHTS.semantic +
    keyword * SCORE_WEIGHTS.keyword +
    weight * SCORE_WEIGHTS.weight +
    recency * SCORE_WEIGHTS.recency +
    feedbackScore * SCORE_WEIGHTS.feedback +
    triggerQuality * SCORE_WEIGHTS.triggerQuality;

  return {
    score: clamp(score, 0, 1),
    triggerQuality,
    triggerQualityRaw,
    feedbackScore,
  };
}

function tokenSetForNeuron(neuron) {
  return new Set(tokenize([neuron?.core?.concept, neuron?.core?.summary].filter(Boolean).join(" ")));
}

function tokenOverlapRatio(tokensA, tokensB) {
  if (!tokensA.size || !tokensB.size) return 0;
  return keywordOverlap(tokensA, [...tokensB]);
}

function getBaseConceptKey(concept) {
  const normalized = normalizeText(concept);
  if (!normalized) return "";
  const synsets = [
    ["dinero", "finanzas", "gastos", "presupuesto", "ahorro", "inversion", "inversiones"],
    ["terapia", "psicologo", "psicologa", "psicologia", "sesion psicologica", "sesion", "acompanamiento"],
  ];

  for (const group of synsets) {
    if (group.some((term) => normalized.includes(term))) return group[0];
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  return parts[0] || normalized;
}

export async function similarityBetweenNeurons(n1, n2) {
  const n1Text = [n1?.core?.concept, n1?.core?.summary, ...(n1?.triggers || [])].join(" ");
  const n2Text = [n2?.core?.concept, n2?.core?.summary, ...(n2?.triggers || [])].join(" ");
  const [emb1, emb2] = await Promise.all([getEmbedding(n1Text), getEmbedding(n2Text)]);
  const cosine = cosineSimilarity(emb1, emb2);
  const tokenOverlap = Math.max(tokenOverlapRatio(tokenSetForNeuron(n1), tokenSetForNeuron(n2)), tokenOverlapRatio(tokenSetForNeuron(n2), tokenSetForNeuron(n1)));
  const baseConceptMatch = getBaseConceptKey(n1?.core?.concept) && getBaseConceptKey(n1?.core?.concept) === getBaseConceptKey(n2?.core?.concept);

  return { cosine, tokenOverlap, baseConceptMatch };
}

export async function enforceNeuronDiversity(neurons, options = {}) {
  const topK = options.topK ?? 5;
  const selected = [];
  const removed = [];

  for (const candidate of neurons) {
    let duplicateInfo = null;
    for (const selectedEntry of selected) {
      const sim = await similarityBetweenNeurons(candidate.neuron, selectedEntry.neuron);
      const tooSimilar = sim.cosine > 0.85 || sim.tokenOverlap > 0.65 || sim.baseConceptMatch;
      if (tooSimilar) {
        duplicateInfo = {
          id: candidate.neuron.id,
          removedBy: selectedEntry.neuron.id,
          cosine: Number(sim.cosine.toFixed(3)),
          tokenOverlap: Number(sim.tokenOverlap.toFixed(3)),
          baseConceptMatch: sim.baseConceptMatch,
          reason: sim.baseConceptMatch ? "same_base_concept" : "semantic_overlap",
        };
        break;
      }
    }

    if (duplicateInfo) {
      removed.push(duplicateInfo);
      continue;
    }

    selected.push(candidate);
    if (selected.length >= topK) break;
  }

  return { selected, removed };
}

function estimateCoverage(input, selection = []) {
  const inputTokens = tokenize(input).filter((token) => !STOPWORDS.has(token));
  if (!inputTokens.length) return 1;

  const coveredTokens = new Set();
  for (const entry of selection) {
    const tokens = tokenize([
      entry.neuron?.core?.concept,
      entry.neuron?.core?.summary,
      ...(entry.neuron?.triggers || []),
    ].filter(Boolean).join(" "));
    for (const token of tokens) {
      if (inputTokens.includes(token)) coveredTokens.add(token);
    }
  }

  return coveredTokens.size / inputTokens.length;
}

export function detectBridgeNeuronNeed({ input, activated = [], finalSelection = [], missingAnalysis = null }) {
  const coverage = Number.isFinite(missingAnalysis?.coverage)
    ? missingAnalysis.coverage
    : estimateCoverage(input, finalSelection);
  const hasStrongNeuron = finalSelection.some((entry) => (entry.scoreFinal ?? entry.score ?? 0) > 0.6);

  const representedTokens = new Set(finalSelection.flatMap((entry) => tokenize([
    entry.neuron?.core?.concept,
    entry.neuron?.core?.summary,
    ...(entry.neuron?.triggers || []),
  ].filter(Boolean).join(" "))));
  const candidateTokens = tokenize(input).filter((t) => !STOPWORDS.has(t) && t.length > 3);
  const missingConceptTokens = candidateTokens.filter((token) => !representedTokens.has(token));

  const weakCluster = activated.length >= 3 && activated.every((entry) => (entry.scoreFinal ?? entry.score ?? 0) < 0.55);
  const needsBridge = coverage < 0.4 && !hasStrongNeuron && (missingConceptTokens.length > 0 || weakCluster);

  if (!needsBridge) {
    return {
      bridgeSuggested: false,
      coverage: Number(coverage.toFixed(3)),
      reason: null,
      bridgeSuggestion: null,
      missingConceptTokens,
    };
  }

  const conceptHint = missingConceptTokens.slice(0, 3).join(" ") || "concepto pendiente";
  return {
    bridgeSuggested: true,
    coverage: Number(coverage.toFixed(3)),
    reason: "missing semantic anchor",
    missingConceptTokens,
    bridgeSuggestion: {
      type: "bridge",
      conceptHint,
      summaryHint: `Memoria puente sobre ${conceptHint} para conectar el mensaje con una ancla semántica clara.`,
      triggerHints: missingConceptTokens.slice(0, 4),
      reason: "missing semantic anchor",
    },
  };
}

export const neuronScoreWeights = { ...SCORE_WEIGHTS };
