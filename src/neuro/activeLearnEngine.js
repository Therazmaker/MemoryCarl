/**
 * activeLearnEngine.js — Motor de aprendizaje activo desde respuestas de Gemini
 * NeuroChat / MemoryCarl
 *
 * Exporta:
 *   chooseReplyMode(params)             → "autonomous" | "assisted" | "delegated"
 *   extractKnowledgeFromGeminiReply(params) → { relationHints, triggerCandidates, quality }
 *   applyTriggerCandidates(params)      → number (triggers aplicados)
 */

import { tokenize } from "./utils.js";
import { getAllNeurons, updateNeuron } from "./neuronStore.js";

// ---- Constantes de decisión ----

const AUTONOMOUS_COVERAGE_THRESHOLD = 0.65; // coverage >= 65% → autónomo
const ASSISTED_COVERAGE_THRESHOLD = 0.35; // coverage >= 35% → asistido
const MIN_PATTERNS_FOR_AUTONOMOUS = 5; // necesita al menos 5 patrones aprendidos
const MIN_RELATIONS_FOR_AUTONOMOUS = 3; // y al menos 3 relaciones en el grafo

/**
 * Elige el modo de respuesta óptimo para el turno actual.
 *
 * @param {{
 *   coverage: number,
 *   activatedCount: number,
 *   patternCount: number,
 *   relationCount: number,
 *   mode: string,
 *   isNeuroclawConfigured: boolean,
 *   isGeminiConfigured: boolean,
 *   isOllamaConfigured: boolean,
 * }} params
 * @returns {"ollama" | "autonomous" | "assisted" | "delegated"}
 */
export function chooseReplyMode({
  coverage = 0,
  activatedCount = 0,
  patternCount = 0,
  relationCount = 0,
  mode = "chat",
  isNeuroclawConfigured = false,
  isGeminiConfigured = false,
  isOllamaConfigured = false,
}) {
  // Ollama es el motor primario: si está configurado, siempre lo usamos
  // (excepto cuando el sistema local tiene cobertura perfecta y muchos patrones)
  if (isOllamaConfigured) {
    // Solo omitir Ollama si el sistema local es verdaderamente autónomo y completo
    const isFullyAutonomous = (
      coverage >= AUTONOMOUS_COVERAGE_THRESHOLD
      && patternCount >= MIN_PATTERNS_FOR_AUTONOMOUS * 2  // umbral más alto para preferir local
      && relationCount >= MIN_RELATIONS_FOR_AUTONOMOUS * 2
      && activatedCount >= 5
    );
    if (isFullyAutonomous) return "autonomous";
    return "ollama";
  }

  // Sin ninguna IA disponible → siempre autónomo
  if (!isNeuroclawConfigured && !isGeminiConfigured) return "autonomous";

  // Modos que siempre necesitan IA para ser útiles
  if (mode === "exercise") return isGeminiConfigured ? "delegated" : "autonomous";

  // Sistema con buena cobertura y suficientes patrones → autónomo
  if (
    coverage >= AUTONOMOUS_COVERAGE_THRESHOLD
    && patternCount >= MIN_PATTERNS_FOR_AUTONOMOUS
    && (relationCount >= MIN_RELATIONS_FOR_AUTONOMOUS || activatedCount >= 3)
  ) {
    return "autonomous";
  }

  // Cobertura media pero hay neuronas activadas → asistido (Gemini)
  if (
    coverage >= ASSISTED_COVERAGE_THRESHOLD
    && activatedCount >= 1
    && isGeminiConfigured
  ) {
    return "assisted";
  }

  // Sin contexto suficiente → delegar si hay Gemini o NeuroClaw
  if (isGeminiConfigured) return "delegated";
  if (isNeuroclawConfigured) return "delegated";

  // Fallback
  return "autonomous";
}

/**
 * Extrae conocimiento estructurado de una respuesta de Gemini.
 * No guarda nada — devuelve hints para que el caller decida qué aplicar.
 *
 * @param {{
 *   userInput: string,
 *   geminiReply: string,
 *   activated: Array<{neuron: object, score: number}>,
 *   localDraft?: string,
 * }} params
 * @returns {{
 *   relationHints: Array<{sourceId, targetId, type, reason}>,
 *   triggerCandidates: Array<{neuronId, token, score}>,
 *   quality: "high" | "medium" | "low",
 *   delta: number,
 * }}
 */
export function extractKnowledgeFromGeminiReply({
  userInput,
  geminiReply,
  activated = [],
  localDraft = "",
} = {}) {
  const safeActivated = Array.isArray(activated) ? activated : [];
  const relationHints = extractRelationHints(geminiReply, safeActivated);
  const triggerCandidates = extractTriggerCandidates(userInput, geminiReply, safeActivated);
  const quality = assessReplyQuality(geminiReply, safeActivated);
  const delta = localDraft ? computeDelta(localDraft, geminiReply) : 1.0;

  return {
    relationHints,
    triggerCandidates,
    quality,
    delta,
  };
}

/**
 * Aplica candidatos de trigger a las neuronas correspondientes.
 * Solo aplica si el token aún no es trigger y la neurona tiene buena historia.
 *
 * @param {{ triggerCandidates: Array<{neuronId, token, score}>, minScore?: number }} params
 * @returns {number} número de triggers aplicados
 */
export function applyTriggerCandidates({ triggerCandidates = [], minScore = 0.4 } = {}) {
  if (!triggerCandidates.length) return 0;
  const allNeurons = getAllNeurons();
  let applied = 0;

  for (const { neuronId, token, score } of triggerCandidates) {
    if (score < minScore) continue;
    const neuron = allNeurons.find((n) => n.id === neuronId);
    if (!neuron) continue;

    // No añadir si ya existe como trigger
    const normalized = String(token || "").toLowerCase().trim();
    if (!normalized || normalized.length < 3) continue;
    if ((neuron.triggers || []).some((t) => t.toLowerCase() === normalized)) continue;

    // No añadir si la neurona tiene muchos false positives
    const fp = neuron.activationLearning?.falsePositiveCount || 0;
    if (fp >= 5) continue;

    const newTriggers = [...(neuron.triggers || []), normalized].slice(0, 20);
    try {
      updateNeuron(neuronId, { triggers: newTriggers });
      applied++;
    } catch (_e) {
      // noop
    }
  }

  return applied;
}

// ---- Helpers internos ----

function extractRelationHints(replyText, activated) {
  const hints = [];
  const neurons = activated.map((a) => a.neuron).filter(Boolean);
  if (neurons.length < 2) return hints;

  const lower = String(replyText || "").toLowerCase();

  // Detectar patrones causales en el texto de Gemini
  // "X causa Y", "X genera Y", "X lleva a Y", "X produce Y"
  const causalPatterns = [
    /(\w[\w\s]{2,20})\s+(?:causa|genera|provoca|lleva a|produce)\s+(\w[\w\s]{2,20})/gi,
    /(\w[\w\s]{2,20})\s+(?:es consecuencia de|resulta de|viene de)\s+(\w[\w\s]{2,20})/gi,
  ];

  for (const pattern of causalPatterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const termA = match[1].trim();
      const termB = match[2].trim();

      const neuronA = neurons.find((n) => (
        (n.core?.concept || "").toLowerCase().includes(termA)
        || termA.includes((n.core?.concept || "").toLowerCase())
      ));
      const neuronB = neurons.find((n) => (
        (n.core?.concept || "").toLowerCase().includes(termB)
        || termB.includes((n.core?.concept || "").toLowerCase())
      ));

      if (neuronA && neuronB && neuronA.id !== neuronB.id) {
        const isCausal = /causa|genera|provoca|lleva|produce/.test(match[0]);
        hints.push({
          sourceId: neuronA.id,
          targetId: neuronB.id,
          type: isCausal ? "causa" : "consecuencia",
          reason: `Detectado en respuesta Gemini: "${match[0].slice(0, 80)}"`,
        });
      }
    }
  }

  const contradictionPatterns = [
    /(\w[\w\s]{2,20})\s+(?:pero|sin embargo|aunque|a pesar de)\s+(\w[\w\s]{2,20})/gi,
  ];

  for (const pattern of contradictionPatterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const termA = match[1].trim();
      const termB = match[2].trim();
      const nA = neurons.find((n) => (n.core?.concept || "").toLowerCase().includes(termA));
      const nB = neurons.find((n) => (n.core?.concept || "").toLowerCase().includes(termB));
      if (nA && nB && nA.id !== nB.id) {
        hints.push({
          sourceId: nA.id,
          targetId: nB.id,
          type: "contradice",
          reason: "Tensión detectada en respuesta Gemini",
        });
      }
    }
  }

  const seen = new Set();
  return hints.filter((h) => {
    const key = `${h.sourceId}::${h.targetId}::${h.type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 5);
}

function extractTriggerCandidates(userInput, geminiReply, activated) {
  const candidates = [];
  const inputTokens = tokenize(userInput);
  const replyTokens = new Set(tokenize(geminiReply));

  const confirmedTokens = inputTokens.filter((t) => replyTokens.has(t) && t.length >= 4);

  for (const { neuron, score } of activated) {
    if (!neuron?.id) continue;
    const existingTriggers = new Set((neuron.triggers || []).map((t) => t.toLowerCase()));

    for (const token of confirmedTokens) {
      if (existingTriggers.has(token)) continue;
      candidates.push({
        neuronId: neuron.id,
        token,
        score: Number((score * 0.7).toFixed(3)),
      });
    }
  }

  return candidates.slice(0, 20);
}

function assessReplyQuality(replyText, activated) {
  const text = String(replyText || "");
  if (text.length < 40) return "low";

  const activatedConcepts = activated
    .map((a) => (a.neuron?.core?.concept || "").toLowerCase())
    .filter(Boolean);
  const lowerReply = text.toLowerCase();
  const conceptHits = activatedConcepts.filter((c) => lowerReply.includes(c)).length;
  const conceptRatio = activatedConcepts.length > 0 ? conceptHits / activatedConcepts.length : 0;

  if (conceptRatio >= 0.5 && text.length >= 120) return "high";
  if (conceptRatio >= 0.2 || text.length >= 80) return "medium";
  return "low";
}

function computeDelta(localDraft, geminiReply) {
  const localTokens = new Set(tokenize(localDraft));
  const geminiTokens = new Set(tokenize(geminiReply));
  if (!localTokens.size && !geminiTokens.size) return 0;
  const union = new Set([...localTokens, ...geminiTokens]).size;
  const intersection = [...localTokens].filter((t) => geminiTokens.has(t)).length;
  return Number((1 - intersection / union).toFixed(3));
}
