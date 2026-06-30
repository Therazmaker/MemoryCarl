/**
 * localReplyEngine.js — Motor de respuesta local para NeuroChat
 *
 * Construye respuestas conversacionales usando exclusivamente los datos
 * calculados por el pipeline: neuronas activadas, insights, contexto temporal
 * e historial reciente. No requiere NeuroClaw ni Gemini.
 *
 * Exporta:
 *   buildLocalReply(params) → string
 */

import { tokenize } from "./utils.js";

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function inferIntent(userInput, activated = [], history = []) {
  const lower = normalize(userInput);
  const topNeuron = activated[0]?.neuron;
  const topEmotion = topNeuron?.emotion || "neutral";
  const lastAssistantMsg = [...history].reverse().find((m) => m.role === "assistant");

  if (/\?/.test(String(userInput || "")) || /^(que|como|cuando|por que|donde|quien)\b/.test(lower)) {
    return "pregunta_directa";
  }

  const negativeEmotions = ["sadness", "anger", "fear", "shame", "disgust"];
  const emotionalWords = /(me siento|estoy|siento que|me pone|me agobia|me cuesta|me duele|me preocupa|tengo miedo|estoy mal)/;
  if (negativeEmotions.includes(topEmotion) || emotionalWords.test(lower)) {
    return "validar_emocion";
  }

  if (/(que hago|deberia|debo|no se como|no puedo|estoy atascado|me bloqueo|necesito|quiero cambiar|quiero mejorar)/.test(lower)) {
    return "sugerir_accion";
  }

  if (lastAssistantMsg && /\?/.test(lastAssistantMsg.content || "") && activated.length >= 2) {
    return "explorar_patron";
  }

  if (/(siempre|nunca|cada vez|cuando pasa|me pasa|suelo|tiendo|me repite|otra vez)/.test(lower)) {
    return "explorar_patron";
  }

  return "reflexion_libre";
}

function detectTurnSignal(userInput, history = []) {
  const lower = normalize(userInput);
  const lastAssistant = [...history].reverse().find((m) => m.role === "assistant");
  if (!lastAssistant) return "neutral";

  const confirms = /^(si|exacto|asi es|claro|correcto|tienes razon|efectivamente|eso mismo|justo|verdad|es verdad)/.test(lower);
  const denies = /^(no|para nada|no es asi|no exactamente|no tanto|tampoco|incorrecto|al contrario)/.test(lower);
  const expands = lower.length > 60 || /(ademas|tambien|pero|aunque|sin embargo|lo que pasa|lo que ocurre)/.test(lower);

  if (confirms) return "confirma";
  if (denies) return "niega";
  if (expands) return "expande";
  return "neutral";
}

function generateQuestion(topNeuron, intent, orientation = "present") {
  if (!topNeuron) return "¿Qué más te genera esto?";

  const concept = topNeuron.core?.concept || "";
  const domain = topNeuron.core?.domain || "";
  const triggers = (topNeuron.triggers || []).slice(0, 3);
  const stage = topNeuron.temporal?.stage || "";
  const timeCtx = topNeuron.temporal?.timeContext || "timeless";

  const domainQuestions = {
    work: {
      explorar_patron: `¿Esto de "${concept}" aparece más en momentos de presión o cuando hay incertidumbre sobre qué hacer?`,
      sugerir_accion: `¿Hay algún momento del día o de la semana donde "${concept}" sea más manejable?`,
      validar_emocion: `¿Cuánto tiempo llevas sintiendo esto en relación a "${concept}"?`,
      reflexion_libre: `¿Cómo describirías la diferencia entre "${concept}" cuando va bien y cuando no?`,
      pregunta_directa: `¿Qué parte de "${concept}" es la que más energía te quita ahora mismo?`,
    },
    personal: {
      explorar_patron: `¿Esto que describes de "${concept}" es algo que reconoces de antes o aparece como algo nuevo?`,
      sugerir_accion: `¿Qué cambiaría si pudieras hacer una sola cosa diferente respecto a "${concept}"?`,
      validar_emocion: `¿Hay algún momento del día en el que "${concept}" pesa más?`,
      reflexion_libre: `¿Cómo has vivido "${concept}" en distintos momentos de tu vida?`,
      pregunta_directa: `¿Qué es lo que más te cuesta entender de "${concept}"?`,
    },
    relationship: {
      explorar_patron: `¿Esto que sientes respecto a "${concept}" cambia dependiendo de con quién estés?`,
      sugerir_accion: `¿Hay algo que aún no has dicho sobre "${concept}" que sientas que debería decirse?`,
      validar_emocion: `¿Cuándo fue la primera vez que notaste este patrón con "${concept}"?`,
      reflexion_libre: `¿Cómo imaginas que "${concept}" podría verse diferente en seis meses?`,
      pregunta_directa: `¿Qué parte de "${concept}" sientes que entiendes menos?`,
    },
  };

  const domainKey = Object.keys(domainQuestions).find((k) =>
    domain.toLowerCase().includes(k) || concept.toLowerCase().includes(k)
  ) || null;

  if (domainKey && domainQuestions[domainKey][intent]) {
    return domainQuestions[domainKey][intent];
  }

  if (triggers.length > 0) {
    const tokenHints = tokenize(String(concept || domain || ""));
    const preferred = triggers.find((t) => tokenHints.includes(normalize(t).split(/\s+/)[0]));
    const trigger = preferred || triggers[Math.floor(Math.random() * triggers.length)];
    if (intent === "explorar_patron") return `¿"${trigger}" es algo que aparece solo en ciertos contextos o de forma más constante?`;
    if (intent === "validar_emocion") return `¿Cuando aparece "${trigger}", suele venir acompañado de algo más?`;
    if (intent === "sugerir_accion") return `¿Qué harías diferente si "${trigger}" dejara de ser un obstáculo?`;
  }

  if (orientation === "past" && timeCtx !== "timeless") {
    return `¿En qué se parece lo que describes ahora con cómo fue "${concept}" en ese momento?`;
  }
  if (stage) {
    return `¿Sientes que esta etapa de "${concept}" todavía está activa o ya la ves desde fuera?`;
  }

  return `¿Hay algo de "${concept || domain}" que sientas que aún no has podido poner en palabras?`;
}

function buildBlock(intent, topNeuron, secondNeuron, insight, turnSignal, orientation) {
  const concept = topNeuron?.core?.concept || "esto";
  const domain = topNeuron?.core?.domain || "";
  const summary = topNeuron?.core?.summary || "";
  const emotion = topNeuron?.emotion || "neutral";
  const concept2 = secondNeuron?.core?.concept || "";
  const iSummary = insight?.summary || "";

  const turnPrefix = {
    confirma: "Tiene sentido. ",
    niega: "Entendido, quizás estaba enfocando mal. ",
    expande: "Eso suma al cuadro. ",
    neutral: "",
  }[turnSignal] || "";

  switch (intent) {
    case "validar_emocion": {
      const emotionLabel = {
        sadness: "pesadez", anger: "rabia", fear: "miedo",
        shame: "vergüenza", disgust: "rechazo", anxiety: "ansiedad",
      }[emotion] || "lo que describes";
      const line1 = `${turnPrefix}Lo que describes tiene que ver con "${concept}"${domain ? ` en el área de ${domain}` : ""}.`;
      const line2 = summary
        ? `${summary.charAt(0).toUpperCase() + summary.slice(1)}.`
        : `Esa sensación de ${emotionLabel} es real y tiene contexto.`;
      const line3 = concept2
        ? `También se activa "${concept2}", así que no parece algo aislado.`
        : (iSummary ? iSummary : "");
      return [line1, line2, line3].filter(Boolean).join(" ");
    }

    case "explorar_patron": {
      const line1 = `${turnPrefix}Lo que aparece aquí es un patrón alrededor de "${concept}"${domain ? ` (${domain})` : ""}.`;
      const line2 = summary || "Parece que esto se activa en ciertos contextos específicos.";
      const line3 = concept2
        ? `También aparece "${concept2}", lo que sugiere que hay algo que conecta ambos.`
        : (iSummary || "");
      return [line1, line2, line3].filter(Boolean).join(" ");
    }

    case "sugerir_accion": {
      const line1 = `${turnPrefix}Basándome en "${concept}"${domain ? ` (${domain})` : ""}: ${summary || "hay un punto concreto desde donde moverse"}.`;
      const line2 = concept2
        ? `Hay algo relacionado con "${concept2}" que también podría ser relevante aquí.`
        : "";
      const line3 = "Un paso pequeño suele ser más útil que un plan grande.";
      return [line1, line2, line3].filter(Boolean).join(" ");
    }

    case "pregunta_directa": {
      const line1 = `${turnPrefix}Lo que recuerdo sobre "${concept}" es: ${summary || "hay registro de este tema"}.`;
      const line2 = iSummary || "";
      const line3 = orientation === "past"
        ? "Eso ocurrió en un momento donde el contexto era diferente al actual."
        : "";
      return [line1, line2, line3].filter(Boolean).join(" ");
    }

    case "reflexion_libre":
    default: {
      const line1 = `${turnPrefix}Lo que activaste tiene que ver con "${concept}"${summary ? `: ${summary}` : ""}.`;
      const line2 = concept2
        ? `También aparece "${concept2}", lo que puede ser significativo.`
        : "";
      const line3 = iSummary || "";
      return [line1, line2, line3].filter(Boolean).join(" ");
    }
  }
}

/**
 * Construye una respuesta local completa.
 *
 * @param {{
 *   userInput: string,
 *   activated: Array<{neuron: Neuron, score: number}>,
 *   insights: Array<object>,
 *   insightSummary: string,
 *   temporalContext: { orientation: string },
 *   mode: string,
 *   history: Array<{role: string, content: string}>,
 *   missingAnalysis: { coverage: number },
 * }} params
 * @returns {string}
 */
export function buildLocalReply({
  userInput,
  activated = [],
  insights = [],
  insightSummary = "",
  temporalContext = {},
  mode = "chat",
  history = [],
  missingAnalysis = {},
} = {}) {
  try {
    if (!activated.length) {
      return "No tengo recuerdos relacionados con esto todavía. Cuéntame más para que pueda aprender.";
    }

    const topNeuron = activated[0]?.neuron;
    const secondNeuron = activated[1]?.neuron || null;
    const topInsight = insights[0] || (insightSummary ? { summary: insightSummary } : null);
    const orientation = temporalContext?.orientation || "present";
    const coverage = missingAnalysis?.coverage ?? 0;

    const intent = inferIntent(userInput, activated, history);
    const turnSignal = detectTurnSignal(userInput, history);

    const block = buildBlock(intent, topNeuron, secondNeuron, topInsight, turnSignal, orientation);

    const skipQuestion = intent === "pregunta_directa" && coverage >= 0.8;
    const question = skipQuestion ? "" : generateQuestion(topNeuron, intent, orientation);

    const modePrefixes = {
      journal: "Para este diario: ",
      autobiography: "Mirando hacia atrás: ",
      exercise: "Para este ejercicio: ",
      chat: "",
    };
    const prefix = modePrefixes[mode] || "";

    const parts = [prefix + block, question].filter(Boolean);
    return parts.join(" ");
  } catch (_err) {
    return "No tengo recuerdos relacionados con esto todavía. Cuéntame más para que pueda aprender.";
  }
}
