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
    const text = await res.text().catch(() => "");
    console.error("[neuroclawClient] Respuesta no-JSON:", text.slice(0, 300));
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
 * Comprueba si NeuroClaw está configurado (URL + key presentes).
 * @returns {boolean}
 */
export function isNeuroclawConfigured() {
  return !!(getBaseUrl() && getApiKey());
}
