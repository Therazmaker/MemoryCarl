/**
 * activation.js — Motor de activación neuronal
 */

import { getEmbedding, cosineSimilarity } from "./embeddings.js";
import { tokenize, keywordOverlap, clamp, neuronTokenSet, daysSince } from "./utils.js";
import { updateNeuron } from "./neuronStore.js";
import { getBootstrapState } from "./bootstrap.js";
import { computeRecencyWeight, isHistoricalNeuron } from "./temporal.js";

const WEIGHTS = { semantic: 0.42, keyword: 0.20, weight: 0.14, recency: 0.08, emotion: 0.08, temporal: 0.08 };
const DEFAULT_TOP_K = 8;
const MIN_SCORE = 0.15;

export function normalizeScore(score) {
  return clamp(score, 0, 1);
}

function normalizeText(text) {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function computeRecencyBoost(lastActivated) {
  if (!lastActivated) return 0.3;
  const days = daysSince(lastActivated);
  if (days < 1) return 1.0;
  if (days < 3) return 0.85;
  if (days < 7) return 0.65;
  if (days < 30) return 0.40;
  if (days < 90) return 0.20;
  return 0.05;
}

export function detectPastOrPresentOrientation(input, _options = {}) {
  const lower = normalizeText(input);
  const pastHints = ["antes", "cuando era", "hace anos", "hace años", "de niño", "de nina", "infancia", "adolescencia", "en 20"];
  const presentHints = ["hoy", "ahora", "últimamente", "ultimamente", "esta semana", "me pasa", "actualmente", "en estos dias"];
  const past = pastHints.some((h) => lower.includes(h));
  const present = presentHints.some((h) => lower.includes(h));
  if (past && present) return "mixed";
  if (past) return "past";
  return "present";
}

export function computeTemporalActivationBoost(input, neuron, options = {}) {
  const orientation = options.orientation || detectPastOrPresentOrientation(input);
  const temporalWeight = Number(neuron?.temporal?.recencyWeight ?? computeRecencyWeight(neuron?.temporal?.timestamp || neuron?.temporal?.date));
  const historical = isHistoricalNeuron(neuron);
  const stage = String(neuron?.temporal?.stage || "").toLowerCase();
  const lower = normalizeText(input);
  let boost = 0;

  if (orientation === "past") boost += historical ? 0.18 : -0.08;
  else if (orientation === "present") boost += historical ? -0.12 : 0.12;
  else boost += historical ? 0.02 : 0.05;

  if (stage && lower.includes(stage.replaceAll("_", " "))) boost += 0.1;
  boost += (temporalWeight - 0.5) * 0.18;

  return clamp(boost, -0.22, 0.25);
}

export function computeKeywordMatch(queryTokens, neuron) {
  if (!queryTokens.length) return 0;
  return keywordOverlap(queryTokens, [...neuronTokenSet(neuron)]);
}

export function computeAliasMatch(input, neuron) {
  const aliases = neuron?.meta?.aliases || [];
  if (!aliases.length) return 0;

  const normalizedInput = normalizeText(input);
  let best = 0;

  for (const alias of aliases) {
    const a = normalizeText(alias);
    if (!a) continue;
    if (normalizedInput === a) best = Math.max(best, 1);
    const exactPattern = new RegExp(`(^|\\b)${escapeRegExp(a)}(\\b|$)`, "i");
    if (exactPattern.test(normalizedInput)) best = Math.max(best, 0.92);
    else if (normalizedInput.includes(a)) best = Math.max(best, 0.72);
  }

  return best;
}

export function isLikelyEntityMention(input, neuron) {
  const concept = normalizeText(neuron?.core?.concept);
  const normalizedInput = normalizeText(input);
  if (!concept || !normalizedInput) return false;
  if (normalizedInput.includes(concept)) return true;
  return computeAliasMatch(input, neuron) >= 0.9;
}

export function getManualNeuronBoost(neuron, options = {}) {
  if (neuron?.source?.kind !== "manual") return 0;
  const aliasMatch = options.aliasMatch ?? 0;
  const entityMention = options.entityMention ?? false;
  const conceptMention = options.conceptMention ?? false;
  const hasMatchSignal = aliasMatch > 0.38 || entityMention || conceptMention;

  if (!hasMatchSignal) return 0;

  let boost = 0;
  boost += aliasMatch >= 0.9 ? 0.22 : aliasMatch >= 0.72 ? 0.16 : 0.1;
  if (entityMention) boost += 0.1;
  if (neuron.meta?.priority === "high") boost += 0.06;
  else if (neuron.meta?.priority === "medium") boost += 0.03;

  if (neuron.meta?.pin) boost += 0.04;
  return clamp(boost, 0, 0.35);
}

export function computeEmotionMatch(userInput, neuronEmotion) {
  if (!neuronEmotion || neuronEmotion === "neutral") return 0.5;
  const lower = userInput.toLowerCase();
  const emotionKeywords = {
    joy: ["feliz", "contento", "alegría", "bien", "logro", "éxito"],
    sadness: ["triste", "dolor", "pérdida", "soledad"],
    anger: ["enojado", "rabia", "furioso", "frustrado"],
    fear: ["miedo", "asustado", "angustia", "ansiedad"],
    surprise: ["sorpresa", "inesperado", "wow"],
    curiosity: ["curioso", "quiero saber", "interesante"],
    pride: ["orgulloso", "logré", "meta", "éxito"],
    shame: ["vergüenza", "culpa", "fallé", "error"],
    love: ["amor", "extraño", "familia", "pareja", "amigo"],
  };
  return (emotionKeywords[neuronEmotion] || []).some((kw) => lower.includes(kw)) ? 1.0 : 0.2;
}

export function computeNeuronFeedbackBoost(neuron) {
  const stats = neuron?.feedbackStats || {};
  const learning = neuron?.activationLearning || {};
  const likes = Math.max(0, Number(stats.likes) || 0);
  const dislikes = Math.max(0, Number(stats.dislikes) || 0);
  const usefulCount = Math.max(0, Number(learning.usefulCount) || 0);
  const falsePositiveCount = Math.max(0, Number(learning.falsePositiveCount) || 0);

  const totalVotes = likes + dislikes;
  const voteSignal = totalVotes > 0 ? (likes - dislikes) / totalVotes : 0;
  const confidence = Math.min(totalVotes / 10, 1);

  const totalLearning = usefulCount + falsePositiveCount;
  const learningSignal = totalLearning > 0 ? (usefulCount - falsePositiveCount) / totalLearning : 0;

  let boost = voteSignal * 0.06 * confidence + learningSignal * 0.045;
  if (dislikes >= 4 && likes === 0) boost -= 0.015;
  return clamp(boost, -0.08, 0.08);
}

export function getActivationTuning(totalNeurons, options = {}) {
  const bootstrapState = options.bootstrapState || getBootstrapState(totalNeurons, options.bootstrapOptions);
  const minScore = options.minScore ?? (
    bootstrapState.level === "strong" ? 0.11 : bootstrapState.level === "normal" ? 0.13 : MIN_SCORE
  );

  if (!bootstrapState.enabled) {
    return { minScore, weights: { ...WEIGHTS }, bootstrapAdjusted: false, semanticRelaxation: 0, keywordBoost: 0, bootstrapState };
  }

  const keywordBoost = bootstrapState.level === "strong" ? 0.08 : 0.05;
  const semanticRelaxation = keywordBoost;
  const semantic = Math.max(0.30, WEIGHTS.semantic - semanticRelaxation);
  const keyword = Math.min(0.35, WEIGHTS.keyword + keywordBoost);

  return {
    minScore,
    weights: { ...WEIGHTS, semantic, keyword },
    bootstrapAdjusted: true,
    semanticRelaxation,
    keywordBoost,
    bootstrapState,
  };
}

export async function activateNeurons(userInput, neurons, options = {}) {
  const topK = options.topK ?? DEFAULT_TOP_K;
  const persist = options.persistActivation !== false;

  if (!userInput || !neurons.length) return [];

  const tuning = getActivationTuning(options.totalNeurons ?? neurons.length, options);
  const minScore = options.minScore ?? tuning.minScore;

  if (options.traceMeta && typeof options.traceMeta === "object") {
    options.traceMeta.activationThreshold = minScore;
    options.traceMeta.bootstrapAdjusted = tuning.bootstrapAdjusted;
    options.traceMeta.weights = tuning.weights;
    options.traceMeta.semanticRelaxation = tuning.semanticRelaxation;
    options.traceMeta.keywordBoost = tuning.keywordBoost;
  }

  const queryTokens = tokenize(userInput);
  const queryEmbed = await getEmbedding(userInput);
  const now = new Date().toISOString();
  const orientation = detectPastOrPresentOrientation(userInput, options);
  if (options.traceMeta && typeof options.traceMeta === "object") options.traceMeta.temporalOrientation = orientation;

  const scored = await Promise.all(neurons.map(async (neuron) => {
    let neuronEmbed = neuron.embedding;
    if (!Array.isArray(neuronEmbed) || neuronEmbed.length === 0) {
      const neuronText = [neuron.core.concept, neuron.core.summary, ...neuron.triggers, ...(neuron.meta?.aliases || [])].join(" ");
      neuronEmbed = await getEmbedding(neuronText);
    }

    const semantic = cosineSimilarity(queryEmbed, neuronEmbed);
    const keyword = computeKeywordMatch(queryTokens, neuron);
    const weight = clamp(neuron.weight, 0, 1);
    const recency = computeRecencyBoost(neuron.lastActivated);
    const temporalBoost = computeTemporalActivationBoost(userInput, neuron, { orientation, ...options });
    const emotion = computeEmotionMatch(userInput, neuron.emotion);
    const aliasMatch = computeAliasMatch(userInput, neuron);
    const entityMention = isLikelyEntityMention(userInput, neuron);
    const conceptMention = normalizeText(userInput).includes(normalizeText(neuron.core?.concept || ""));
    const manualBoost = getManualNeuronBoost(neuron, { aliasMatch, entityMention, conceptMention });
    const neuronFeedbackBoost = computeNeuronFeedbackBoost(neuron);

    const score = normalizeScore(
      semantic * tuning.weights.semantic +
      keyword * tuning.weights.keyword +
      weight * tuning.weights.weight +
      recency * tuning.weights.recency +
      emotion * tuning.weights.emotion +
      temporalBoost * tuning.weights.temporal +
      manualBoost +
      neuronFeedbackBoost
    );

    return { neuron, score, components: { semantic, keyword, weight, recency, emotion, temporalBoost, aliasMatch, manualBoost, neuronFeedbackBoost } };
  }));

  const activated = scored.filter((r) => r.score >= minScore).sort((a, b) => b.score - a.score).slice(0, topK);

  if (persist) {
    for (const { neuron } of activated) {
      try {
        updateNeuron(neuron.id, { lastActivated: now, timesActivated: (neuron.timesActivated || 0) + 1 });
      } catch (_e) {}
    }
  }

  return activated;
}
