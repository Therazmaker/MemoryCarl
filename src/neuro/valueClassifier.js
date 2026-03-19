/**
 * valueClassifier.js — Clasificador heurístico de valor de input
 * NeuroChat / MemoryCarl
 *
 * Determina si un mensaje del usuario merece gastar una llamada premium
 * de aprendizaje para generar neuronas de alta calidad.
 *
 * No usa ML pesado: heurísticas extensibles por señales léxicas y estructurales.
 */

import { tokenize } from "./utils.js";

// ---- Configuración de señales ----

// Palabras que indican emoción
const EMOTION_WORDS = [
  "siento", "siento que", "me siento", "emocionado", "angustiado", "triste",
  "feliz", "asustado", "ansioso", "orgulloso", "frustrado", "enojado",
  "contento", "deprimido", "eufórico", "nervioso", "aliviado", "culpable",
  "emoción", "sentimiento", "amor", "odio", "miedo", "alegría", "dolor",
  "feel", "feeling", "emotion", "sad", "happy", "angry", "anxious",
];

// Palabras que indican contenido autobiográfico / memoria personal
const AUTOBIO_WORDS = [
  "hoy", "ayer", "esta semana", "este mes", "mi vida", "mi historia",
  "recuerdo que", "cuando era", "aprendí que", "descubrí que", "me pasó",
  "me di cuenta", "en mi caso", "personalmente", "yo creo", "yo pienso",
  "mi experiencia", "viví", "sufrí", "logré", "fallé", "cometí",
  "today", "yesterday", "my life", "i realized", "i learned", "i remember",
];

// Lenguaje de insight / cambio de creencia
const INSIGHT_WORDS = [
  "me di cuenta", "entendí", "comprendí", "cambié de opinión", "antes pensaba",
  "ahora creo", "aprendí que", "fue un error", "equivoqué", "insight",
  "revelación", "breakthrough", "cambio de paradigma", "nuevo enfoque",
  "i realized", "i understand now", "changed my mind", "i was wrong",
  "now i know", "revelation", "paradigm shift",
];

// Patrones de reflexión sobre trading / finanzas / hábitos
const DOMAIN_SPECIFIC_WORDS = [
  // Trading / finanzas
  "trade", "trading", "posición", "stop loss", "entrada", "salida", "profit",
  "drawdown", "riesgo", "ganancia", "pérdida", "mercado", "tendencia",
  "estrategia", "análisis", "señal", "bitcoin", "crypto", "acción", "forex",
  // Hábitos
  "hábito", "rutina", "disciplina", "constancia", "meditación", "ejercicio",
  "dieta", "sueño", "productividad", "procrastinación",
  // Aprendizaje
  "aprendizaje", "estudio", "práctica deliberada", "feedback", "mejora",
  "skill", "conocimiento", "dominar",
  // Finanzas personales
  "ahorro", "inversión", "deuda", "presupuesto", "gastos", "ingresos",
];

// Patrones de decisiones importantes
const DECISION_WORDS = [
  "decidí", "tomé la decisión", "voy a", "planeo", "quiero cambiar",
  "decidido", "dejaré de", "empezaré a", "mi objetivo", "meta",
  "decided", "i will", "my goal", "i plan to", "resolution",
];

// Patrones repetidos / preguntas que revelan huecos
const PATTERN_LANGUAGE = [
  "siempre", "nunca", "de nuevo", "otra vez", "cada vez que", "pattern",
  "patrón", "tendencia", "repetición", "loop", "ciclo", "sigo haciendo",
  "me pasa siempre", "again", "always", "never", "every time",
];

// Señales de bajo valor
const LOW_VALUE_GREETINGS = [
  "hola", "hi", "hello", "hey", "buenos días", "buenas tardes", "buenas noches",
  "qué tal", "como estás", "cómo estás", "cómo te va", "bien", "ok", "okay",
];

const LOW_VALUE_CONFIRMATIONS = [
  "sí", "no", "si", "claro", "exacto", "correcto", "de acuerdo", "entendido",
  "gracias", "ok", "vale", "perfecto", "yes", "no", "sure", "got it", "thanks",
];

const LOW_VALUE_LOGISTICS = [
  "cuándo", "dónde", "qué hora", "cómo se llama", "cuál es el", "qué día",
  "when", "where", "what time", "how to", "which",
];

// ---- Helpers ----

/**
 * Cuenta cuántos items de una lista aparecen en el texto (case-insensitive).
 * @param {string} text
 * @param {string[]} list
 * @returns {number}
 */
function countMatches(text, list) {
  const lower = text.toLowerCase();
  return list.filter((w) => lower.includes(w.toLowerCase())).length;
}

/**
 * Calcula densidad semántica: ratio de tokens únicos / tokens totales.
 * @param {string[]} tokens
 * @returns {number}
 */
function semanticDensity(tokens) {
  if (!tokens.length) return 0;
  const unique = new Set(tokens).size;
  return unique / tokens.length;
}

// ---- API pública ----

/**
 * Extrae señales del input.
 *
 * @param {string} userInput
 * @param {object} [options]
 * @returns {object} mapa de señales booleanas y cuantitativas
 */
export function extractInputSignals(userInput, options = {}) {
  if (!userInput || typeof userInput !== "string") {
    return {
      wordCount: 0,
      charCount: 0,
      hasEmotion: false,
      hasAutobiographicalContent: false,
      hasInsightLanguage: false,
      hasRepeatedPatternLanguage: false,
      hasDomainSpecificContent: false,
      hasImportantDecision: false,
      isShortUtilityMessage: true,
      isGreeting: true,
      isConfirmation: true,
      isLogisticsQuestion: false,
      semanticDensity: 0,
    };
  }

  const tokens    = tokenize(userInput);
  const wordCount = tokens.length;
  const charCount = userInput.trim().length;
  const lower     = userInput.toLowerCase();

  const emotionCount  = countMatches(userInput, EMOTION_WORDS);
  const autobioCount  = countMatches(userInput, AUTOBIO_WORDS);
  const insightCount  = countMatches(userInput, INSIGHT_WORDS);
  const patternCount  = countMatches(userInput, PATTERN_LANGUAGE);
  const domainCount   = countMatches(userInput, DOMAIN_SPECIFIC_WORDS);
  const decisionCount = countMatches(userInput, DECISION_WORDS);

  const greetingMatch  = LOW_VALUE_GREETINGS.some((g) => lower === g || lower.startsWith(g + " ") || lower.endsWith(" " + g));
  const confirmMatch   = wordCount <= 3 && LOW_VALUE_CONFIRMATIONS.some((c) => lower.includes(c.toLowerCase()));
  const logisticsMatch = wordCount <= 8 && countMatches(userInput, LOW_VALUE_LOGISTICS) > 0;

  return {
    wordCount,
    charCount,
    hasEmotion:                 emotionCount >= 1,
    hasAutobiographicalContent: autobioCount >= 1,
    hasInsightLanguage:         insightCount >= 1,
    hasRepeatedPatternLanguage: patternCount >= 1,
    hasDomainSpecificContent:   domainCount >= 1,
    hasImportantDecision:       decisionCount >= 1,
    isShortUtilityMessage:      wordCount <= 4 && !domainCount && !emotionCount,
    isGreeting:                 greetingMatch && wordCount <= 5,
    isConfirmation:             confirmMatch,
    isLogisticsQuestion:        logisticsMatch,
    semanticDensity:            semanticDensity(tokens),
    // Conteos brutos útiles para debug
    _counts: { emotionCount, autobioCount, insightCount, patternCount, domainCount, decisionCount },
  };
}

/**
 * Clasifica el valor de un input de usuario.
 *
 * @param {string} userInput
 * @param {object} [options]
 * @param {number} [options.highThreshold=0.60]
 * @param {number} [options.lowThreshold=0.25]
 * @returns {{ label: "low"|"medium"|"high", score: number, signals: object, reasons: string[] }}
 */
export function classifyInputValue(userInput, options = {}) {
  const signals = extractInputSignals(userInput, options);
  const reasons = [];
  let score = 0;

  // ---- Señales negativas (reducen o limitan el score) ----
  if (signals.isGreeting) {
    reasons.push("saludo detectado");
    return { label: "low", score: 0.05, signals, reasons };
  }
  if (signals.isConfirmation) {
    reasons.push("confirmación / respuesta corta");
    return { label: "low", score: 0.08, signals, reasons };
  }
  if (signals.isShortUtilityMessage && signals.wordCount <= 3) {
    reasons.push("mensaje muy corto sin contenido semántico");
    return { label: "low", score: 0.10, signals, reasons };
  }
  if (signals.isLogisticsQuestion) {
    reasons.push("pregunta logística de bajo valor");
    return { label: "low", score: 0.12, signals, reasons };
  }

  // ---- Señales positivas ----

  // Longitud suficiente
  if (signals.wordCount >= 20) {
    score += 0.15;
    reasons.push("mensaje largo (>20 palabras)");
  } else if (signals.wordCount >= 10) {
    score += 0.08;
    reasons.push("mensaje de longitud media");
  } else if (signals.wordCount >= 5) {
    score += 0.03;
  }

  // Densidad semántica
  if (signals.semanticDensity >= 0.80) {
    score += 0.10;
    reasons.push("alta densidad semántica");
  }

  // Emoción
  if (signals.hasEmotion) {
    score += 0.15;
    reasons.push("presencia de emoción");
  }

  // Autobiografía / memoria personal
  if (signals.hasAutobiographicalContent) {
    score += 0.15;
    reasons.push("contenido autobiográfico / memoria personal");
  }

  // Insight / cambio de creencia
  if (signals.hasInsightLanguage) {
    score += 0.20;
    reasons.push("lenguaje de insight o cambio de creencia");
  }

  // Patrones repetidos
  if (signals.hasRepeatedPatternLanguage) {
    score += 0.12;
    reasons.push("lenguaje de patrón repetido");
  }

  // Dominio específico (trading, finanzas, hábitos, etc.)
  if (signals.hasDomainSpecificContent) {
    score += 0.15;
    reasons.push("contenido de dominio específico (trading/finanzas/hábitos)");
  }

  // Decisión importante
  if (signals.hasImportantDecision) {
    score += 0.12;
    reasons.push("decisión importante detectada");
  }

  score = Math.min(1, score);

  const highThreshold = options.highThreshold ?? 0.60;
  const lowThreshold  = options.lowThreshold  ?? 0.25;

  const label = score >= highThreshold ? "high" : score >= lowThreshold ? "medium" : "low";

  return { label, score, signals, reasons };
}

/**
 * Devuelve true si el input es de alto valor (merece llamada premium).
 *
 * @param {string} userInput
 * @param {object} [options]
 * @param {number} [options.threshold=0.60]
 * @returns {boolean}
 */
export function isHighValueInput(userInput, options = {}) {
  const threshold = options.threshold ?? 0.60;
  const { score } = classifyInputValue(userInput, options);
  return score >= threshold;
}
