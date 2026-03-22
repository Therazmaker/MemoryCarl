/**
 * neuroclawClient.js — Cliente HTTP para el backend NeuroClaw
 * MemoryCarl
 *
 * Funciones:
 *   - requestNeuronGeneration(payload) → genera neuronas faltantes
 *   - requestChatReply(payload)        → obtiene respuesta conversacional
 *
 * La URL base y el key se leen de localStorage (igual que el sistema existente).
 * No se hardcodean secretos.
 */

const KEYS = {
  url: "memorycarl_v2_neuroclaw_ai_url",
  key: "memorycarl_v2_neuroclaw_ai_key",
};

const DEFAULT_TIMEOUT_MS = 15_000;

// ---- Config ----

function getBaseUrl() {
  try { return (localStorage.getItem(KEYS.url) || "").trim().replace(/\/+$/, ""); }
  catch (_e) { return ""; }
}

function getApiKey() {
  try { return (localStorage.getItem(KEYS.key) || "").trim(); }
  catch (_e) { return ""; }
}

// ---- Helpers ----

/**
 * Fetch con timeout.
 * @param {string} url
 * @param {RequestInit} opts
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(url, opts, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parsea JSON de forma segura desde un Response.
 * @param {Response} res
 * @returns {Promise<any>}
 */
async function safeJson(res) {
  try { return await res.json(); }
  catch (_e) {
    console.error("[neuroclawClient] Respuesta no-JSON del servidor (ver Network en DevTools).");
    return null;
  }
}

/**
 * Realiza una llamada POST a NeuroClaw.
 * @param {string} endpoint — ruta relativa (ej. "/neurochat/generate")
 * @param {any} body
 * @returns {Promise<any>}
 */
async function callNeuroClaw(endpoint, body) {
  const base = getBaseUrl();
  const key  = getApiKey();

  if (!base || !key) {
    console.warn("[neuroclawClient] Sin configuración de NeuroClaw (URL/key vacíos).");
    return null;
  }

  const url = `${base}${endpoint}`;
  console.log(`[neuroclawClient] POST ${url}`);

  const res = await fetchWithTimeout(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "x-mc-key":     key,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errData = await safeJson(res);
    console.error(`[neuroclawClient] HTTP ${res.status} en ${endpoint}:`, errData);
    return null;
  }

  return safeJson(res);
}

// ---- API pública ----

/**
 * Solicita la generación de neuronas faltantes a NeuroClaw.
 *
 * Payload enviado al backend:
 * {
 *   task: "generate_neurons",
 *   userInput, activatedNeurons, missingConcepts, coverage, reasons,
 *   systemPrompt: "..."
 * }
 *
 * Respuesta esperada: { neurons: [...] } o directamente un array
 *
 * @param {object} payload
 * @returns {Promise<Neuron[]|null>}
 */
export async function requestNeuronGeneration(payload) {
  const body = {
    task: "generate_neurons",
    systemPrompt:
      "Eres un generador de neuronas para un cerebro personal. " +
      "Analiza el input del usuario y las neuronas activadas. " +
      "Detecta qué conocimiento faltante sería útil para enriquecer futuras conversaciones. " +
      "Devuelve exclusivamente JSON válido con una lista de nuevas neuronas en campo 'neurons'. " +
      "No devuelvas texto adicional. " +
      "Cada neurona debe tener: type, core.concept, core.domain, core.summary, triggers, emotion, evidence. " +
      "Las neuronas deben ser específicas, útiles, conectables y no redundantes.",
    ...payload,
  };

  const data = await callNeuroClaw("/neurochat/generate", body);
  if (!data) return null;

  // Acepta tanto { neurons: [...] } como un array directo
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.neurons)) return data.neurons;
  console.warn("[neuroclawClient] Formato inesperado en generate_neurons:", data);
  return null;
}

/**
 * Solicita una respuesta de chat a NeuroClaw (vía Gemini).
 *
 * Payload enviado al backend:
 * {
 *   task: "chat_reply",
 *   userInput, context, history,
 *   systemPrompt: "..."
 * }
 *
 * Respuesta esperada: { reply: "string" }
 *
 * @param {object} payload
 * @returns {Promise<string|null>} el texto de respuesta o null
 */
export async function requestChatReply(payload) {
  const body = {
    task: "chat_reply",
    systemPrompt:
      "Responde como una inteligencia personalizada con memoria contextual. " +
      "No des consejos moralistas ni actúes como terapeuta. " +
      "Habla con cercanía, claridad y profundidad. " +
      "Basa la respuesta en el contexto neuronal provisto. " +
      "Si detectas patrones, menciónalos con naturalidad. " +
      "No inventes recuerdos que no estén en el contexto. " +
      "Usa insights como marco interpretativo sin repetirlos mecánicamente. " +
      "Distingue patrones actuales vs históricos usando temporalContext. " +
      "No presentes algo del pasado como identidad actual sin evidencia reciente. " +
      "Si no hay señal suficiente en insights, no extrapoles. " +
      "No uses tono robótico.",
    ...payload,
  };

  const data = await callNeuroClaw("/neurochat/reply", body);
  if (!data) return null;

  if (typeof data.reply === "string") return data.reply;
  if (typeof data.text  === "string") return data.text;
  if (typeof data.human === "string") return data.human;
  console.warn("[neuroclawClient] Formato inesperado en chat_reply:", data);
  return null;
}

/**
 * Envía el contenido de un día al backend NeuroClaw para refinamiento con Gemini.
 *
 * Payload enviado al backend:
 * {
 *   task: "day_refine",
 *   rawChat, memories, linkedNeurons,
 *   currentSummary, currentEmotion, currentThemes, currentInsights, date,
 *   systemPrompt: "..."
 * }
 *
 * Respuesta esperada:
 * {
 *   improvedSummary, correctedEmotion, refinedThemes, insights,
 *   neuronAdjustments: { merge:[], update:[], remove:[], create:[] },
 *   memorySuggestions: [{ title, text, importance }]
 * }
 *
 * @param {object} payload
 * @returns {Promise<object|null>}
 */
export async function requestDayRefine(payload) {
  const body = {
    task: "day_refine",
    systemPrompt:
      "You are an advanced cognitive refinement engine. Your task is to analyze a full day of a user's experiences and improve the system's understanding of that day. You are NOT a chatbot. You are a system optimizer.\n\n" +

      "PART 1 — UNDERSTAND THE DAY (CRITICAL): Do NOT treat messages independently. " +
      "Reconstruct the narrative of the day. Understand emotional progression. Identify what truly mattered. " +
      "Focus on: tension, change, internal conflict, relationships, decisions, frustration or breakthroughs.\n\n" +

      "PART 2 — IMPROVE DAY SUMMARY: Rewrite the summary so it reflects the main emotional tone, key events, " +
      "the internal state of the user, and relationships involved. " +
      "Do NOT be generic. Do NOT list topics. Write like a concise psychological observation.\n\n" +

      "PART 3 — DETECT DOMINANT EMOTION: Choose one of: " +
      "joy, sadness, anger, fear, surprise, disgust, curiosity, pride, shame, love, neutral, mixed. " +
      "Avoid 'neutral' unless truly neutral. Use 'mixed' if emotional conflict exists. " +
      "Prioritize emotional reality over literal words.\n\n" +

      "PART 4 — EXTRACT THEMES: Return 3 to 6 themes. " +
      "Rules: semantic, not keywords; no filler words; no trivial tokens. " +
      "Examples: 'transición laboral', 'presión interna por rendimiento', 'desalineación emocional con pareja'.\n\n" +

      "PART 5 — GENERATE INSIGHTS (VERY IMPORTANT): Produce 1 to 3 insights. " +
      "Each insight must be specific to THIS day, connect behavior + emotion + context, and NOT be generic or motivational. " +
      "Bad: 'User experiences stress during difficult times.' " +
      "Good: 'When facing uncertainty in work, the user increases internal pressure, which spills over into frustration and affects alignment with close relationships.'\n\n" +

      "PART 6 — NEURON REFINEMENT: Analyze existing neurons and decide which are useful, redundant, wrong, or missing. " +
      "Return neuronAdjustments with: create (new meaningful concepts, reusable, not hyper-specific), " +
      "update (improve summaries and triggers), merge (if two neurons represent the same concept), " +
      "remove (only if clearly useless or redundant). Do NOT over-create neurons — quality over quantity.\n\n" +

      "PART 7 — MEMORY SUGGESTIONS (OPTIONAL BUT POWERFUL): If a moment in the day is important but not stored as memory, " +
      "suggest it with title, text, and importance ('high', 'medium', or 'low'). Only if truly meaningful.\n\n" +

      "OUTPUT FORMAT (STRICT JSON — return ONLY JSON, no markdown, no extra text):\n" +
      "{\n" +
      '  "improvedSummary": "string",\n' +
      '  "correctedEmotion": "string",\n' +
      '  "refinedThemes": ["string"],\n' +
      '  "insights": ["string"],\n' +
      '  "neuronAdjustments": { "create": [], "update": [], "merge": [], "remove": [] },\n' +
      '  "memorySuggestions": [{ "title": "string", "text": "string", "importance": "high|medium|low" }]\n' +
      "}\n\n" +

      "CRITICAL RULES: NO generic outputs. NO repetition. NO empty sections unless truly nothing to add. " +
      "NO hallucinated facts. DO NOT fabricate events not present in input. " +
      "PRIORITIZE clarity and usefulness. Be precise. Be structured. Be meaningful.",
    ...payload,
  };

  const data = await callNeuroClaw("/neurochat/day-refine", body);
  if (!data) return null;

  if (typeof data.improvedSummary === "string" || Array.isArray(data.refinedThemes) || Array.isArray(data.insights)) {
    return data;
  }
  console.warn("[neuroclawClient] Formato inesperado en day_refine:", data);
  return null;
}

/**
 * Comprueba si NeuroClaw está configurado (URL + key presentes).
 * @returns {boolean}
 */
export function isNeuroclawConfigured() {
  return !!(getBaseUrl() && getApiKey());
}
