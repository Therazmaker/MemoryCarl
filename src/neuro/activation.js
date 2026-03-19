/**
 * activation.js — Motor de activación neuronal
 */

import { getEmbedding, cosineSimilarity } from "./embeddings.js";
import { tokenize, keywordOverlap, clamp, neuronTokenSet, daysSince } from "./utils.js";
import { updateNeuron } from "./neuronStore.js";
import { getBootstrapState } from "./bootstrap.js";

const WEIGHTS = { semantic: 0.45, keyword: 0.20, weight: 0.15, recency: 0.10, emotion: 0.10 };
const DEFAULT_TOP_K = 8;
const MIN_SCORE = 0.15;

export function normalizeScore(score) {
  return clamp(score, 0, 1);
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

export function computeKeywordMatch(queryTokens, neuron) {
  if (!queryTokens.length) return 0;
  return keywordOverlap(queryTokens, [...neuronTokenSet(neuron)]);
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

  const scored = await Promise.all(neurons.map(async (neuron) => {
    let neuronEmbed = neuron.embedding;
    if (!Array.isArray(neuronEmbed) || neuronEmbed.length === 0) {
      const neuronText = [neuron.core.concept, neuron.core.summary, ...neuron.triggers].join(" ");
      neuronEmbed = await getEmbedding(neuronText);
    }

    const semantic = cosineSimilarity(queryEmbed, neuronEmbed);
    const keyword = computeKeywordMatch(queryTokens, neuron);
    const weight = clamp(neuron.weight, 0, 1);
    const recency = computeRecencyBoost(neuron.lastActivated);
    const emotion = computeEmotionMatch(userInput, neuron.emotion);

    const score = normalizeScore(
      semantic * tuning.weights.semantic +
      keyword * tuning.weights.keyword +
      weight * tuning.weights.weight +
      recency * tuning.weights.recency +
      emotion * tuning.weights.emotion
    );

    return { neuron, score, components: { semantic, keyword, weight, recency, emotion } };
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
