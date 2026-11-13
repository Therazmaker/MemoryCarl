/**
 * geminiPremiumClient.js — Cliente de Gemini API para generación premium de neuronas
 * MemoryCarl
 *
 * Solo se usa para generar neuronas de alta calidad cuando premium está activo.
 * El chat principal sigue usando NeuroClaw.
 *
 * Exporta:
 *   isGeminiPremiumConfigured()
 *   getGeminiPremiumSettings()
 *   requestGeminiPremiumNeuronGeneration(payload)
 *   requestGeminiDayRefine(payload)
 *   requestAssistedReply(payload)
 *   streamGeminiNeuronGeneration(payload, onChunk)
 *   parseGeminiJsonResponse(raw)
 *   sanitizeGeminiNeuronPayload(payload)
 */

import { getNeuroChatSettings } from "../settings/neurochatSettings.js";
import { sanitizeNeuron, validateNeuron } from "../neuro/schemas.js";

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// ---- Estado / configuración ----

/**
 * Devuelve los settings de Gemini premium desde la configuración persistida.
 * @returns {object}
 */
export function getGeminiPremiumSettings() {
  return getNeuroChatSettings();
}

/**
 * Indica si el cliente premium está correctamente configurado
 * (tiene API key y está habilitado).
 * @returns {boolean}
 */
export function isGeminiPremiumConfigured() {
  const s = getGeminiPremiumSettings();
  return Boolean(s.enabled && s.apiKey && s.apiKey.trim().length > 8);
}

// ---- Construcción del prompt ----

/**
 * Construye el prompt de generación de neuronas para Gemini.
 * @param {{ userInput: string, activatedNeurons: object[], missingAnalysis: object, history?: object[] }} payload
 * @returns {string}
 */
function buildGenerationPrompt({ userInput, activatedNeurons, missingAnalysis, history = [] }) {
  const activatedSummary = activatedNeurons
    .slice(0, 5)
    .map((r) => {
      const n = r.neuron || r;
      return `- [${n.type}] ${n.core?.concept || ""} (${n.core?.domain || "general"}): ${n.core?.summary || ""}`;
    })
    .join("\n");

  const missingList = (missingAnalysis?.missingConcepts || []).slice(0, 8).join(", ") || "(ninguno detectado)";
  const reasons     = (missingAnalysis?.reasons || []).slice(0, 3).join("; ") || "";
  const recentTurns = history
    .filter((m) => m.role === "user")
    .slice(-3)
    .map((m) => `• ${String(m.content || "").slice(0, 120)}`)
    .join("\n");

  return `Eres un sistema de memoria personal inteligente. Tu tarea es identificar patrones, creencias, hábitos o reglas personales de alto valor que deberían memorizarse para mejorar futuras conversaciones.

## Input del usuario
${userInput}

## Neuronas ya activadas (contexto existente)
${activatedSummary || "(ninguna)"}

## Conceptos no cubiertos detectados
${missingList}

## Razones de cobertura insuficiente
${reasons || "(no especificadas)"}

${recentTurns ? `## Conversación reciente\n${recentTurns}` : ""}

## Instrucciones
- Detecta patrones faltantes REALMENTE útiles para futuras conversaciones.
- NO repitas conceptos ya cubiertos por las neuronas activadas.
- Máximo 3 neuronas nuevas.
- Cada neurona debe ser específica, conectable y no redundante.
- NO inventes recuerdos no soportados por el input o contexto.
- Prioriza: patrones, memorias útiles, hábitos, creencias o reglas personales de alto valor.
- Si no hay información valiosa que memorizar, devuelve un array vacío.

## Formato de respuesta (JSON estricto, sin markdown, sin texto adicional)
{
  "neurons": [
    {
      "type": "pattern",
      "core": {
        "concept": "...",
        "domain": "...",
        "summary": "..."
      },
      "triggers": ["..."],
      "emotion": "neutral",
      "evidence": ["..."],
      "source": {
        "kind": "generated",
        "ref": "gemini_premium"
      }
    }
  ]
}

Responde SOLO con el JSON. No incluyas explicaciones, comentarios ni markdown.`;
}

// ---- Parseo robusto ----

/**
 * Parsea la respuesta cruda de Gemini y extrae el array de neuronas.
 * Tolera: markdown fences, texto adicional, { neurons: [...] } o array directo.
 * @param {string} raw
 * @returns {{ neurons: any[] }}
 */
export function parseGeminiJsonResponse(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Respuesta Gemini vacía o inválida");
  }

  let text = raw.trim();

  // Quitar markdown fences (```json ... ``` o ``` ... ```)
  text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  // Intentar extraer el primer bloque JSON si hay texto extra
  const jsonMatch = text.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (jsonMatch) {
    text = jsonMatch[0];
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`No se pudo parsear JSON de Gemini: ${e.message}`);
  }

  // Tolerar { neurons: [...] } o array directo
  if (Array.isArray(parsed)) {
    return { neurons: parsed };
  }
  if (parsed && Array.isArray(parsed.neurons)) {
    return { neurons: parsed.neurons };
  }

  // Si hay otro campo array, intentar encontrarlo
  if (parsed && typeof parsed === "object") {
    const arrays = Object.values(parsed).filter(Array.isArray);
    if (arrays.length === 1) {
      return { neurons: arrays[0] };
    }
  }

  throw new Error("Estructura JSON de Gemini no reconocida");
}

/**
 * Sanitiza y valida un array de payloads de neuronas de Gemini.
 * Devuelve solo las neuronas que pasan validación.
 * @param {any[]} rawNeurons
 * @returns {import('../neuro/schemas.js').Neuron[]}
 */
export function sanitizeGeminiNeuronPayload(rawNeurons) {
  if (!Array.isArray(rawNeurons)) return [];

  return rawNeurons
    .map((raw) => {
      if (!raw || typeof raw !== "object") return null;
      try {
        const n = sanitizeNeuron({
          ...raw,
          source: { kind: "generated", ref: "gemini_premium" },
        });
        if (!n) return null;
        // Rechazar neuronas sin concepto o resumen mínimo
        if (!n.core.concept || n.core.concept.length < 3) return null;
        if (!n.core.summary && !n.triggers.length) return null;
        const errs = validateNeuron(n);
        if (errs.length > 0) return null;
        return n;
      } catch (_e) {
        return null;
      }
    })
    .filter(Boolean)
    .slice(0, 3); // máximo 3 neuronas premium por llamada
}

// ---- Llamada a la API ----

/**
 * Hace la llamada real a Gemini API para generar neuronas premium.
 * @param {{ userInput: string, activatedNeurons: object[], missingAnalysis: object, history?: object[] }} payload
 * @returns {Promise<import('../neuro/schemas.js').Neuron[]>}
 */
export async function requestGeminiPremiumNeuronGeneration(payload, onRetryProgress = null) {
  const settings = getGeminiPremiumSettings();

  if (!isGeminiPremiumConfigured()) {
    throw new Error("Gemini premium no configurado (apiKey ausente o disabled)");
  }

  const prompt   = buildGenerationPrompt(payload);
  const model    = settings.model    || "gemini-2.5-flash";
  const timeout  = settings.timeoutMs || 20000;
  const url      = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${settings.apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature:     settings.temperature     ?? 0.4,
      maxOutputTokens: settings.maxOutputTokens ?? 4096,
    },
  };

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      if (typeof onRetryProgress === "function") {
        try { onRetryProgress({ attempt, maxAttempts, service: "gemini" }); } catch (_e) {}
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
        signal:  controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        lastError = new Error(`Gemini timeout después de ${timeout}ms`);
      } else {
        lastError = new Error(`Error de red al llamar Gemini: ${err.message}`);
      }
      console.warn(`[geminiPremiumClient] Intento ${attempt}/${maxAttempts} error:`, lastError.message);
      continue;
    }

    if (!response.ok) {
      let errText = "";
      try { errText = await response.text(); } catch (_e) {}
      lastError = new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
      console.warn(`[geminiPremiumClient] Intento ${attempt}/${maxAttempts} HTTP ${response.status}`);
      continue;
    }

    let json;
    try {
      json = await response.json();
    } catch (e) {
      lastError = new Error(`Gemini devolvió respuesta no-JSON: ${e.message}`);
      continue;
    }

    const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) {
      lastError = new Error("Gemini no devolvió contenido en candidates[0].content.parts[0].text");
      continue;
    }

    const { neurons: rawNeurons } = parseGeminiJsonResponse(rawText);
    return sanitizeGeminiNeuronPayload(rawNeurons);
  }

  throw lastError || new Error("Fallaron todos los intentos con Gemini");
}

const DAY_REFINE_MIN_TIMEOUT = 90_000;   // un día entero + razonamiento tarda más de 20 s
const DAY_REFINE_MIN_TOKENS  = 8192;     // el JSON completo no cabe en 4096 si el modelo además "piensa"
const DAY_REFINE_ATTEMPTS    = 3;

/** Recorta el día para el prompt: mensajes largos y campos que Gemini no necesita. */
function compactDayPayload(payload = {}) {
  const clip = (s, n) => { const t = String(s ?? ""); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const rawChat = (Array.isArray(payload.rawChat) ? payload.rawChat : [])
    .map((m) => ({ role: m?.role, content: clip(m?.content ?? m?.text ?? "", 1200), ...(m?.ts || m?.timestamp ? { ts: m.ts || m.timestamp } : {}) }))
    .filter((m) => m.content);
  return { ...payload, rawChat: rawChat.slice(-150) };
}

/** Texto de la respuesta: une todas las partes (sin las de razonamiento). */
function geminiResponseText(json) {
  const parts = json?.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p && !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
}

function friendlyDayRefineError(err) {
  const m = String(err?.message || err || "");
  if (/timeout/i.test(m)) return "Gemini tardó demasiado en responder";
  if (/\b(429)\b/.test(m)) return "Gemini está limitando las peticiones (cuota por minuto)";
  if (/\b(500|502|503|504)\b/.test(m)) return "Gemini está saturado en este momento";
  if (/\b(400|401|403)\b/.test(m)) return `Gemini rechazó la petición: ${m.slice(0, 160)}`;
  if (/MAX_TOKENS|cortada/i.test(m)) return "La respuesta de Gemini salió cortada";
  return m || "error desconocido";
}

/**
 * Refina un día completo usando Gemini API (sin backend NeuroClaw).
 * Reintenta solo (hasta 3 veces) cuando Gemini está saturado, tarda, limita la cuota
 * o devuelve un JSON cortado: antes había que darle al botón varias veces.
 *
 * @param {object} payload
 * @param {{ settings?: object, fetchImpl?: Function, sleep?: Function, onRetry?: Function }} [deps]
 * @returns {Promise<object>}
 */
export async function requestGeminiDayRefine(payload = {}, deps = {}) {
  const settings = deps.settings || getGeminiPremiumSettings();
  const configured = deps.settings
    ? Boolean(settings.enabled !== false && settings.apiKey && String(settings.apiKey).trim().length > 8)
    : isGeminiPremiumConfigured();
  if (!configured) throw new Error("Gemini no configurado");
  const doFetch = deps.fetchImpl || ((...a) => fetch(...a));
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));

  const model = settings.model || "gemini-2.5-flash";
  const timeout = Math.max(Number(settings.timeoutMs) || 0, DAY_REFINE_MIN_TIMEOUT);
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${settings.apiKey}`;

  const prompt = `You are an advanced cognitive refinement engine. Your task is to analyze a full day of a user's experiences and improve the system's understanding of that day. You are NOT a chatbot. You are a system optimizer.

PART 1 — UNDERSTAND THE DAY (CRITICAL): Do NOT treat messages independently. Reconstruct the narrative of the day. Understand emotional progression. Identify what truly mattered. Focus on: tension, change, internal conflict, relationships, decisions, frustration or breakthroughs.

PART 2 — IMPROVE DAY SUMMARY: Rewrite the summary so it reflects the main emotional tone, key events, the internal state of the user, and relationships involved. Do NOT be generic. Do NOT list topics. Write like a concise psychological observation.

PART 3 — DETECT DOMINANT EMOTION: Choose one of: joy, sadness, anger, fear, surprise, disgust, curiosity, pride, shame, love, neutral, mixed. Avoid 'neutral' unless truly neutral. Use 'mixed' if emotional conflict exists. Prioritize emotional reality over literal words.

PART 4 — EXTRACT THEMES: Return 3 to 6 themes. Rules: semantic, not keywords; no filler words; no trivial tokens.

PART 5 — GENERATE INSIGHTS (VERY IMPORTANT): Produce 1 to 3 insights. Each insight must be specific to THIS day, connect behavior + emotion + context, and NOT be generic or motivational.

PART 6 — NEURON REFINEMENT: Analyze existing neurons and decide which are useful, redundant, wrong, or missing. Return neuronAdjustments with: create, update, merge, remove.

PART 7 — MEMORY SUGGESTIONS (OPTIONAL BUT POWERFUL): If a moment in the day is important but not stored as memory, suggest it with title, text, and importance ('high', 'medium', or 'low').

OUTPUT FORMAT (STRICT JSON — return ONLY JSON, no markdown, no extra text):
{
  "improvedSummary": "string",
  "correctedEmotion": "string",
  "refinedThemes": ["string"],
  "insights": ["string"],
  "neuronAdjustments": { "create": [], "update": [], "merge": [], "remove": [] },
  "memorySuggestions": [{ "title": "string", "text": "string", "importance": "high|medium|low" }]
}

CRITICAL RULES: NO generic outputs. NO repetition. NO hallucinated facts. DO NOT fabricate events not present in input.

INPUT DATA:
${JSON.stringify(compactDayPayload(payload))}
`;

  const generationConfig = {
    temperature: settings.temperature ?? 0.4,
    maxOutputTokens: Math.max(Number(settings.maxOutputTokens) || 0, DAY_REFINE_MIN_TOKENS),
    responseMimeType: "application/json",
  };
  // En 2.5 el razonamiento gasta del mismo presupuesto de salida: se limita para que quepa el JSON
  if (/gemini-2\.5/i.test(model)) generationConfig.thinkingConfig = { thinkingBudget: /pro/i.test(model) ? 2048 : 1024 };
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig });

  let lastError = null;
  for (let attempt = 1; attempt <= DAY_REFINE_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      try { deps.onRetry?.({ attempt, maxAttempts: DAY_REFINE_ATTEMPTS, error: lastError }); } catch (_e) {}
      const is429 = /\b429\b/.test(String(lastError?.message));
      await sleep(is429 ? 8000 * (attempt - 1) : 1500 * 2 ** (attempt - 2));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    let response;
    try {
      response = await doFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal });
    } catch (err) {
      lastError = new Error(err?.name === "AbortError" ? "Gemini day refine timeout" : `Error de red: ${err?.message}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      lastError = new Error(`Gemini day refine error ${response.status}: ${txt.slice(0, 200)}`);
      // 400/401/403/404: la clave o el modelo están mal, reintentar no sirve
      if ([400, 401, 403, 404].includes(response.status)) break;
      continue;
    }

    let json;
    try { json = await response.json(); } catch (e) { lastError = new Error(`Gemini devolvió algo que no es JSON: ${e.message}`); continue; }
    const finish = json?.candidates?.[0]?.finishReason;
    let text = geminiResponseText(json);
    if (!text) {
      const block = json?.promptFeedback?.blockReason;
      lastError = new Error(block ? `Gemini bloqueó el contenido (${block})` : `Gemini day refine: sin contenido en respuesta${finish ? ` (${finish})` : ""}`);
      if (block) break;
      continue;
    }
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) text = jsonMatch[0];
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      lastError = new Error(finish === "MAX_TOKENS" ? "Gemini day refine: respuesta cortada (MAX_TOKENS)" : `Gemini day refine JSON inválido: ${e.message}`);
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      lastError = new Error("Gemini day refine: estructura inválida");
      continue;
    }
    return parsed;
  }
  const err = new Error(friendlyDayRefineError(lastError));
  err.cause = lastError;
  throw err;
}

/**
 * Llama a Gemini en modo asistido: recibe un borrador local y lo enriquece.
 * Más barato que una generación completa — el prompt es más corto.
 *
 * @param {{
 *   userInput: string,
 *   localDraft: string,
 *   context: Array<object>,
 *   history: Array<object>,
 *   insights: Array<object>,
 *   temporalContext: object,
 * }} payload
 * @returns {Promise<string>} respuesta enriquecida
 */
export async function requestAssistedReply(payload = {}, onRetryProgress = null) {
  const settings = getGeminiPremiumSettings();
  if (!isGeminiPremiumConfigured()) {
    throw new Error("Gemini no configurado");
  }

  const {
    userInput = "",
    localDraft = "",
    context = [],
    insights = [],
    dayContext = null,
    financeContext = null,
  } = payload;

  const contextSummary = context.slice(0, 4)
    .map((n) => `- ${n.concept} (${n.domain}): ${n.summary}`)
    .join("\n");

  const insightLine = insights.slice(0, 1).map((i) => i.summary).join(" ");

  const dayContextPrompt = Array.isArray(dayContext)
    ? "\nContexto de días previos relacionados:\n" + dayContext.map(d => `- ${d.date}: ${d.summary} (Emoción: ${d.emotion})`).join("\n")
    : "";

  const financePrompt = financeContext
    ? `\nContexto Financiero (Acumulado Últimos 30 días - Solo lectura):\n⚠️ NOTA: Los totales de ingresos/gastos son acumulados de los últimos 30 días. Si el usuario pregunta por fechas específicas, revisa los movimientos individuales por fecha.\n- Balance actual cuentas: S/ ${(financeContext.totalBalance || 0).toFixed(2)}\n- Acumulado gastos 30d: S/ ${(financeContext.totalExpense30d || 0).toFixed(2)}\n- Acumulado ingresos 30d: S/ ${(financeContext.totalIncome30d || 0).toFixed(2)}\n`
    : "";

  const prompt = `Eres un asistente de memoria personal. Ya se generó este borrador de respuesta:

BORRADOR:
${localDraft}

El usuario dijo: "${userInput}"

Contexto de memoria relevante:
${contextSummary || "(sin contexto adicional)"}
${insightLine ? `\nInsight detectado: ${insightLine}` : ""}
${dayContextPrompt}
${financePrompt}

Tu tarea: mejora el borrador. Puedes hacerlo más específico, más empático, o añadir una observación que el borrador no incluye. Úsalo si detectas que situaciones de días previos se están repitiendo. NO lo hagas más largo de forma innecesaria. Máximo 3 frases adicionales. Mantén el tono del borrador. Responde SOLO con la respuesta mejorada, sin explicaciones.`;

  const model = settings.model || "gemini-2.5-flash";
  const timeout = settings.timeoutMs || 15000;
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${settings.apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.5,
      maxOutputTokens: settings.maxOutputTokens ?? 4096,
    },
  };

  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      if (typeof onRetryProgress === "function") {
        try { onRetryProgress({ attempt, maxAttempts, service: "gemini_assisted" }); } catch (_e) {}
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 500));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === "AbortError") {
        lastError = new Error("Gemini assisted timeout");
      } else {
        lastError = new Error(`Error de red: ${err.message}`);
      }
      continue;
    }

    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      lastError = new Error(`Gemini assisted error ${response.status}: ${txt.slice(0, 100)}`);
      continue;
    }

    const json = await response.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      lastError = new Error("Gemini assisted: sin contenido en respuesta");
      continue;
    }
    return text.trim();
  }

  throw lastError || new Error("Fallaron todos los intentos con Gemini assisted");
}

/**
 * Streaming version of Gemini neuron generation.
 * @param {{ userInput: string, activatedNeurons: object[], missingAnalysis: object, history?: object[] }} payload
 * @param {(chunk: string) => void} onChunk
 * @returns {Promise<string>}
 */
export async function streamGeminiNeuronGeneration(payload, onChunk = () => {}) {
  const settings = getGeminiPremiumSettings();
  if (!isGeminiPremiumConfigured()) {
    throw new Error("Gemini premium no configurado");
  }

  const prompt = buildGenerationPrompt(payload);
  const model = settings.model || "gemini-2.5-flash";
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:streamGenerateContent?alt=sse&key=${settings.apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: settings.temperature ?? 0.4,
      maxOutputTokens: settings.maxOutputTokens ?? 4096,
    },
  };

  const controller = new AbortController();
  const timeout = settings.timeoutMs || 20000;
  const timer = setTimeout(() => controller.abort(), timeout);

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Gemini stream timeout");
    throw new Error(`Error de red: ${err.message}`);
  }

  if (!response.ok) {
    clearTimeout(timer);
    const txt = await response.text().catch(() => "");
    throw new Error(`Gemini stream error ${response.status}: ${txt.slice(0, 200)}`);
  }

  const reader = response.body?.getReader?.();
  if (!reader) {
    clearTimeout(timer);
    throw new Error("Gemini stream no soportado por este navegador");
  }

  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const jsonStr = trimmed.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) {
            fullText += text;
            onChunk(text);
          }
        } catch (_err) {
          // Ignorar líneas SSE incompletas/malformadas
        }
      }
    }
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }

  return fullText;
}

/**
 * Llama a Gemini como un Socratic Pattern Weaver para el NeuroProbe.
 * Recibe el historial de la mini-charla Socrática y el contexto,
 * y devuelve o bien una nueva pregunta reflexiva, o bien una propuesta de neurona.
 *
 * @param {{
 *   context: object,
 *   history: Array<{role, content}>,
 *   recentMemoriesSummary: string
 * }} payload
 * @returns {Promise<{ isDraft: boolean, message: string, proposedNeuron?: object }>}
 */
export async function requestGeminiSocraticProbe(payload = {}) {
  const settings = getGeminiPremiumSettings();
  if (!isGeminiPremiumConfigured()) {
    throw new Error("Gemini no configurado para Probe premium");
  }

  const { context = {}, history = [], recentMemoriesSummary = "" } = payload;
  const historyText = history.map(h => `${h.role}: ${h.content}`).join("\n");

  const prompt = `Eres NeuroProbe, un observador cognitivo socrático. Tu meta es descubrir patrones en la mente del usuario a partir de sus memorias y diálogos, y finalmente formalizarlos en una "Neurona" (concepto).

Contexto inicial (lo que activó la conversación): ${JSON.stringify(context)}
Resumen memorias recientes: ${recentMemoriesSummary || "Sin contexto reciente"}

Historial de la conversación:
${historyText || "(Ninguno, inicia tú la conversación basándote en el contexto)"}

REGLAS:
1. Si necesitas explorar más: Devuelve un mensaje corto y reflexivo, preguntando el "por qué" o haciendo una conexión audaz.
2. Si consideras que el usuario ya ha revelado un patrón o concepto útil formalizable (típicamente tras 2-3 turnos): Devuelve isDraft = true, un mensaje de conclusión, y una proposedNeuron.

FORMATO DE RESPUESTA (Solo JSON, sin markdown):
{
  "isDraft": false/true,
  "message": "tu respuesta socrática o tu conclusión...",
  "proposedNeuron": {
    "type": "pattern",
    "core": { "concept": "nombre del patron", "domain": "dominio", "summary": "tu resumen" },
    "triggers": ["palabra1", "palabra2"],
    "evidence": ["evidencia literal de la charla"]
  } // Solo si isDraft es true
}`;

  const model = settings.model || "gemini-2.5-flash";
  const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${settings.apiKey}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 1024,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error("Error en NeuroProbe Socratic API");
  }

  const json = await response.json();
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  let text = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (match) text = match[0];
  
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error("No se pudo parsear el JSON de SocraticProbe: " + text);
  }
}

