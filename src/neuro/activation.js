/**
 * activation.js — Motor de activación neuronal
 * NeuroChat / MemoryCarl
 *
 * Fórmula de score:
 *   score = semantic_similarity * 0.45
 *         + keyword_match       * 0.20
 *         + weight              * 0.15
 *         + recency             * 0.10
 *         + emotion_match       * 0.10
 */

import { getEmbedding, cosineSimilarity } from "./embeddings.js";
import { tokenize, keywordOverlap, clamp, neuronTokenSet, daysSince } from "./utils.js";
import { updateNeuron } from "./neuronStore.js";

// Pesos de la fórmula (deben sumar 1.0)
const WEIGHTS = {
  semantic:  0.45,
  keyword:   0.20,
  weight:    0.15,
  recency:   0.10,
  emotion:   0.10,
};

// Número máximo de neuronas a devolver por defecto
const DEFAULT_TOP_K = 8;
// Score mínimo para considerar una neurona activada
const MIN_SCORE = 0.15;

// ---- Helpers ----

/**
 * Normaliza un score al rango [0, 1].
 * @param {number} score
 * @returns {number}
 */
export function normalizeScore(score) {
  return clamp(score, 0, 1);
}

/**
 * Calcula el boost de recencia.
 * Neuronas activadas recientemente reciben boost; las antiguas lo pierden.
 * @param {string|null} lastActivated — ISO timestamp
 * @returns {number} [0, 1]
 */
export function computeRecencyBoost(lastActivated) {
  if (!lastActivated) return 0.3; // sin historial → boost neutro bajo
  const days = daysSince(lastActivated);
  if (days < 1)   return 1.0;
  if (days < 3)   return 0.85;
  if (days < 7)   return 0.65;
  if (days < 30)  return 0.40;
  if (days < 90)  return 0.20;
  return 0.05;
}

/**
 * Calcula coincidencia por keywords entre input y neurona.
 * @param {string[]} queryTokens
 * @param {Neuron} neuron
 * @returns {number} [0, 1]
 */
export function computeKeywordMatch(queryTokens, neuron) {
  if (!queryTokens.length) return 0;
  const docTokens = [...neuronTokenSet(neuron)];
  return keywordOverlap(queryTokens, docTokens);
}

/**
 * Calcula coincidencia emocional entre el input (detectada heurística) y la neurona.
 * @param {string} userInput
 * @param {string} neuronEmotion
 * @returns {number} [0, 1]
 */
export function computeEmotionMatch(userInput, neuronEmotion) {
  if (!neuronEmotion || neuronEmotion === "neutral") return 0.5;
  const lower = userInput.toLowerCase();
  // Mapeo simple de palabras clave emocionales en español
  const emotionKeywords = {
    joy:       ["feliz","contento","alegría","genial","perfecto","bien","amor","celebrar","logro","éxito"],
    sadness:   ["triste","tristeza","llorar","dolor","pérdida","soledad","extrañar","sufrir","mal"],
    anger:     ["enojado","enojo","rabia","furioso","molesto","frustrado","harto","indignado"],
    fear:      ["miedo","asustado","angustia","preocupado","nervioso","ansiedad","inseguro"],
    surprise:  ["sorpresa","increíble","impresionante","inesperado","wow","asombroso"],
    curiosity: ["curioso","quiero saber","interesante","pregunta","¿por qué","cómo funciona"],
    pride:     ["orgulloso","logré","conseguí","superé","meta","éxito","logramos"],
    shame:     ["vergüenza","arrepentido","culpa","fallé","error","avergonzado"],
    love:      ["amor","quiero","extraño","cariño","familia","pareja","amigo"],
  };
  const matches = (emotionKeywords[neuronEmotion] || []).some((kw) => lower.includes(kw));
  return matches ? 1.0 : 0.2;
}

// ---- Función principal ----

/**
 * Activa neuronas relevantes para el input del usuario.
 *
 * @param {string} userInput
 * @param {Neuron[]} neurons
 * @param {{ topK?: number, minScore?: number, persistActivation?: boolean }} [options]
 * @returns {Promise<ActivatedNeuron[]>}
 */
export async function activateNeurons(userInput, neurons, options = {}) {
  const topK    = options.topK    ?? DEFAULT_TOP_K;
  const minScore = options.minScore ?? MIN_SCORE;
  const persist  = options.persistActivation !== false; // true por defecto

  if (!userInput || !neurons.length) return [];

  const queryTokens = tokenize(userInput);
  const queryEmbed  = await getEmbedding(userInput);
  const now         = new Date().toISOString();

  const scored = await Promise.all(
    neurons.map(async (neuron) => {
      // 1. Similitud semántica
      let neuronEmbed = neuron.embedding;
      if (!Array.isArray(neuronEmbed) || neuronEmbed.length === 0) {
        const neuronText = [neuron.core.concept, neuron.core.summary, ...neuron.triggers].join(" ");
        neuronEmbed = await getEmbedding(neuronText);
      }
      const semantic = cosineSimilarity(queryEmbed, neuronEmbed);

      // 2. Keyword match
      const keyword = computeKeywordMatch(queryTokens, neuron);

      // 3. Weight de la neurona (ya normalizado 0-1)
      const weight = clamp(neuron.weight, 0, 1);

      // 4. Recencia
      const recency = computeRecencyBoost(neuron.lastActivated);

      // 5. Emoción
      const emotion = computeEmotionMatch(userInput, neuron.emotion);

      // Score compuesto
      const score = normalizeScore(
        semantic  * WEIGHTS.semantic +
        keyword   * WEIGHTS.keyword  +
        weight    * WEIGHTS.weight   +
        recency   * WEIGHTS.recency  +
        emotion   * WEIGHTS.emotion
      );

      return { neuron, score, components: { semantic, keyword, weight, recency, emotion } };
    })
  );

  // Filtrar por minScore y ordenar desc
  const activated = scored
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);

  // Persistir activación (actualizar timesActivated y lastActivated)
  if (persist) {
    for (const { neuron } of activated) {
      try {
        updateNeuron(neuron.id, {
          lastActivated:  now,
          timesActivated: (neuron.timesActivated || 0) + 1,
        });
      } catch (_e) { /* no romper el flujo */ }
    }
  }

  return activated;
}
