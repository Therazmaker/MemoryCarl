/**
 * valueClassifier.js — Clasificador heurístico de valor de input
 * NeuroChat / MemoryCarl
 */

import { tokenize } from "./utils.js";

const EMOTION_WORDS = [
  "siento", "me siento", "emocionado", "angustiado", "triste", "feliz", "asustado", "ansioso",
  "orgulloso", "frustrado", "enojado", "deprimido", "aliviado", "culpable", "sentimiento",
  "amor", "odio", "miedo", "alegría", "dolor", "emotion", "sad", "happy", "angry", "anxious",
];

const AUTOBIO_WORDS = [
  "hoy", "ayer", "esta semana", "mi vida", "mi historia", "recuerdo que", "cuando era", "aprendí que",
  "descubrí que", "me pasó", "me di cuenta", "en mi caso", "personalmente", "mi experiencia", "viví",
  "sufrí", "logré", "fallé", "today", "yesterday", "my life", "i realized", "i learned", "i remember",
];

const INSIGHT_WORDS = [
  "me di cuenta", "entendí", "comprendí", "antes pensaba", "ahora creo", "aprendí que", "fue un error",
  "equivoqué", "insight", "breakthrough", "cambio de paradigma", "i realized", "changed my mind", "now i know",
];

const JOURNAL_WORDS = [
  "diario", "journal", "entrada", "hoy me sentí", "hoy sentí", "escribiendo", "reflexión", "bitácora", "bitacora",
];

const EXERCISE_WORDS = [
  "ejercicio", "respiración", "respiracion", "terapia", "reestructuración", "autoobservación", "mindfulness", "grounding",
];

const MEMORY_WORDS = [
  "recuerdo", "memoria", "pasado", "infancia", "cuando era niño", "cuando era niña", "historia de vida", "antes",
];

const RELATIONSHIP_WORDS = [
  "pareja", "familia", "amistad", "relación", "relacion", "vínculo", "vinculo", "pertenecer", "significado", "propósito", "proposito",
];

const GROWTH_WORDS = [
  "crecer", "mejorar", "sanar", "aprendizaje", "aprendí", "aprendi", "progreso", "madurar", "evolucionar",
];

const CALM_CLOSURE_WORDS = [
  "me siento más en calma", "me siento mas en calma", "cierro el día", "cierro el dia", "respiro", "estoy agradecido",
  "gracias por", "me ayudó", "me ayudo", "me tranquiliza", "peace", "calm",
];

const LOW_VALUE_GREETINGS = ["hola", "hi", "hello", "hey", "buenos días", "buenas tardes", "buenas noches", "qué tal", "como estás", "cómo estás"];
const LOW_VALUE_CONFIRMATIONS = ["sí", "no", "si", "claro", "exacto", "ok", "vale", "perfecto", "yes", "sure", "got it", "thanks"];
const LOW_VALUE_LOGISTICS = ["cuándo", "dónde", "qué hora", "cómo se llama", "cuál es", "when", "where", "what time", "which"];

const MODE_BOOST = {
  chat: 0,
  journal: 0.09,
  autobiography: 0.13,
  exercise: 0.1,
};

function countMatches(text, list) {
  const lower = text.toLowerCase();
  return list.filter((w) => lower.includes(w.toLowerCase())).length;
}

function semanticDensity(tokens) {
  if (!tokens.length) return 0;
  return new Set(tokens).size / tokens.length;
}

function normalizeMode(mode) {
  const m = String(mode || "chat").toLowerCase();
  return ["chat", "journal", "autobiography", "exercise"].includes(m) ? m : "chat";
}

export function extractInputSignals(userInput, options = {}) {
  if (!userInput || typeof userInput !== "string") {
    return {
      wordCount: 0,
      charCount: 0,
      hasEmotion: false,
      hasAutobiographicalContent: false,
      hasInsightLanguage: false,
      isShortUtilityMessage: true,
      isGreeting: true,
      isConfirmation: true,
      isLogisticsQuestion: false,
      semanticDensity: 0,
      appearsJournalLike: false,
      appearsAutobiographical: false,
      hasEmotionSituationThoughtStructure: false,
      hasLearningReflection: false,
      hasSelfNarrative: false,
      hasCalmingClosure: false,
      mentionsPastOrMemory: false,
      mentionsRelationshipMeaning: false,
      mentionsPersonalGrowth: false,
    };
  }

  const tokens = tokenize(userInput);
  const wordCount = tokens.length;
  const charCount = userInput.trim().length;
  const lower = userInput.toLowerCase();

  const emotionCount = countMatches(userInput, EMOTION_WORDS);
  const autobioCount = countMatches(userInput, AUTOBIO_WORDS);
  const insightCount = countMatches(userInput, INSIGHT_WORDS);
  const journalCount = countMatches(userInput, JOURNAL_WORDS);
  const exerciseCount = countMatches(userInput, EXERCISE_WORDS);
  const memoryCount = countMatches(userInput, MEMORY_WORDS);
  const relationshipCount = countMatches(userInput, RELATIONSHIP_WORDS);
  const growthCount = countMatches(userInput, GROWTH_WORDS);
  const calmClosureCount = countMatches(userInput, CALM_CLOSURE_WORDS);

  const greetingMatch = LOW_VALUE_GREETINGS.some((g) => lower === g || lower.startsWith(`${g} `));
  const confirmMatch = wordCount <= 3 && LOW_VALUE_CONFIRMATIONS.some((c) => lower.includes(c.toLowerCase()));
  const logisticsMatch = wordCount <= 8 && countMatches(userInput, LOW_VALUE_LOGISTICS) > 0;

  const hasSelfPronouns = /\b(yo|me|mi|mis|i|my|myself)\b/i.test(userInput);
  const hasSituationWord = /\b(cuando|hoy|ayer|situaci[oó]n|pas[oó]|momento|when|today|yesterday)\b/i.test(userInput);
  const hasThoughtWord = /\b(pienso|pens[eé]|pensamiento|entend[ií]|aprend[ií]|creo|i think|i learned|i realized)\b/i.test(userInput);

  const appearsJournalLike = journalCount > 0 || (hasSelfPronouns && /\b(hoy|ayer|diario|journal)\b/i.test(userInput));
  const appearsAutobiographical = autobioCount > 0 || memoryCount > 0;
  const hasEmotionSituationThoughtStructure = emotionCount > 0 && hasSituationWord && hasThoughtWord;
  const hasLearningReflection = (insightCount > 0 && growthCount > 0) || /\b(lecci[oó]n|aprend[ií]|lesson)\b/i.test(userInput);
  const hasSelfNarrative = hasSelfPronouns && (appearsAutobiographical || hasSituationWord);
  const hasCalmingClosure = calmClosureCount > 0;
  const mentionsPastOrMemory = memoryCount > 0;
  const mentionsRelationshipMeaning = relationshipCount > 0;
  const mentionsPersonalGrowth = growthCount > 0;

  return {
    wordCount,
    charCount,
    hasEmotion: emotionCount >= 1,
    hasAutobiographicalContent: autobioCount >= 1,
    hasInsightLanguage: insightCount >= 1,
    hasExerciseLanguage: exerciseCount >= 1,
    isShortUtilityMessage: wordCount <= 4 && emotionCount === 0 && autobioCount === 0,
    isGreeting: greetingMatch && wordCount <= 5,
    isConfirmation: confirmMatch,
    isLogisticsQuestion: logisticsMatch,
    semanticDensity: semanticDensity(tokens),
    appearsJournalLike,
    appearsAutobiographical,
    hasEmotionSituationThoughtStructure,
    hasLearningReflection,
    hasSelfNarrative,
    hasCalmingClosure,
    mentionsPastOrMemory,
    mentionsRelationshipMeaning,
    mentionsPersonalGrowth,
    _counts: { emotionCount, autobioCount, insightCount, journalCount, exerciseCount, memoryCount },
  };
}

export function classifyInputValue(userInput, options = {}) {
  const mode = normalizeMode(options.mode);
  const bootstrapState = options.bootstrapState || { enabled: false, level: "off" };
  const signals = extractInputSignals(userInput, options);
  const reasons = [];
  let score = 0;

  if (signals.isGreeting) return { label: "low", score: 0.05, signals, reasons: ["saludo detectado"], mode };
  if (signals.isConfirmation) return { label: "low", score: 0.08, signals, reasons: ["confirmación / respuesta corta"] , mode };
  if (signals.isShortUtilityMessage && signals.wordCount <= 3) return { label: "low", score: 0.1, signals, reasons: ["mensaje muy corto sin contenido semántico"], mode };
  if (signals.isLogisticsQuestion) return { label: "low", score: 0.12, signals, reasons: ["pregunta logística de bajo valor"], mode };

  if (signals.wordCount >= 25) { score += 0.18; reasons.push("mensaje largo y detallado"); }
  else if (signals.wordCount >= 12) { score += 0.10; reasons.push("mensaje de longitud media-alta"); }
  else if (signals.wordCount >= 6) score += 0.04;

  if (signals.semanticDensity >= 0.75) { score += 0.10; reasons.push("alta densidad semántica"); }
  if (signals.hasEmotion) { score += 0.12; reasons.push("presencia de emoción"); }
  if (signals.hasAutobiographicalContent) { score += 0.14; reasons.push("contenido autobiográfico"); }
  if (signals.hasInsightLanguage) { score += 0.18; reasons.push("lenguaje de insight"); }

  if (signals.appearsJournalLike) { score += 0.10; reasons.push("señales de diario emocional"); }
  if (signals.appearsAutobiographical) { score += 0.10; reasons.push("señales autobiográficas"); }
  if (signals.hasEmotionSituationThoughtStructure) { score += 0.14; reasons.push("estructura emoción + situación + pensamiento"); }
  if (signals.hasLearningReflection) { score += 0.14; reasons.push("reflexión y aprendizaje detectados"); }
  if (signals.hasSelfNarrative) { score += 0.08; reasons.push("narrativa personal en primera persona"); }
  if (signals.hasCalmingClosure) { score += 0.06; reasons.push("cierre calmante / autorregulación"); }
  if (signals.mentionsPastOrMemory) { score += 0.07; reasons.push("menciones de pasado/memoria"); }
  if (signals.mentionsRelationshipMeaning) { score += 0.07; reasons.push("menciones de relación/significado"); }
  if (signals.mentionsPersonalGrowth) { score += 0.08; reasons.push("menciones de crecimiento personal"); }

  const modeBoost = MODE_BOOST[mode] ?? 0;
  if (modeBoost > 0) {
    score += modeBoost;
    reasons.push(`boost por modo ${mode}`);
  }

  if (bootstrapState?.enabled && (signals.appearsJournalLike || signals.hasLearningReflection || signals.hasSelfNarrative)) {
    score += bootstrapState.level === "strong" ? 0.08 : 0.05;
    reasons.push(`boost por bootstrap ${bootstrapState.level}`);
  }

  score = Math.min(1, score);

  const highThreshold = options.highThreshold
    ?? (bootstrapState?.level === "strong" ? 0.52 : bootstrapState?.level === "normal" ? 0.56 : 0.60);
  const lowThreshold = options.lowThreshold ?? 0.25;

  const label = score >= highThreshold ? "high" : score >= lowThreshold ? "medium" : "low";
  return { label, score, signals, reasons, mode, bootstrapState };
}

export function isHighValueInput(userInput, options = {}) {
  const threshold = options.threshold ?? 0.60;
  const { score } = classifyInputValue(userInput, options);
  return score >= threshold;
}
