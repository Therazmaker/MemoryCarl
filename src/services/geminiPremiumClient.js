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
export async function requestGeminiPremiumNeuronGeneration(payload) {
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

  // Fetch con timeout usando AbortController
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
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error(`Gemini timeout después de ${timeout}ms`);
    }
    throw new Error(`Error de red al llamar Gemini: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let errText = "";
    try { errText = await response.text(); } catch (_e) {}
    throw new Error(`Gemini API error ${response.status}: ${errText.slice(0, 200)}`);
  }

  let json;
  try {
    json = await response.json();
  } catch (e) {
    throw new Error(`Gemini devolvió respuesta no-JSON: ${e.message}`);
  }

  // Extraer el texto de la respuesta
  const rawText = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) {
    throw new Error("Gemini no devolvió contenido en candidates[0].content.parts[0].text");
  }

  const { neurons: rawNeurons } = parseGeminiJsonResponse(rawText);
  return sanitizeGeminiNeuronPayload(rawNeurons);
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
export async function requestAssistedReply(payload = {}) {
  const settings = getGeminiPremiumSettings();
  if (!isGeminiPremiumConfigured()) {
    throw new Error("Gemini no configurado");
  }

  const {
    userInput = "",
    localDraft = "",
    context = [],
    insights = [],
  } = payload;

  const contextSummary = context.slice(0, 4)
    .map((n) => `- ${n.concept} (${n.domain}): ${n.summary}`)
    .join("\n");

  const insightLine = insights.slice(0, 1).map((i) => i.summary).join(" ");

  const prompt = `Eres un asistente de memoria personal. Ya se generó este borrador de respuesta:

BORRADOR:
${localDraft}

El usuario dijo: "${userInput}"

Contexto de memoria relevante:
${contextSummary || "(sin contexto adicional)"}
${insightLine ? `\nInsight detectado: ${insightLine}` : ""}

Tu tarea: mejora el borrador. Puedes hacerlo más específico, más empático, o añadir una observación que el borrador no incluye. NO lo hagas más largo de forma innecesaria. Máximo 3 frases adicionales. Mantén el tono del borrador. Responde SOLO con la respuesta mejorada, sin explicaciones.`;

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
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Gemini assisted timeout");
    throw new Error(`Error de red: ${err.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const txt = await response.text().catch(() => "");
    throw new Error(`Gemini assisted error ${response.status}: ${txt.slice(0, 100)}`);
  }

  const json = await response.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini assisted: sin contenido en respuesta");
  return text.trim();
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
