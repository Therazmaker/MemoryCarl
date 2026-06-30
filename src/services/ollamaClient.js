/**
 * ollamaClient.js — Cliente para Ollama Cloud API
 * MemoryCarl / NeuroChat
 *
 * Ollama Cloud expone la misma interfaz que un servidor Ollama local,
 * pero en https://ollama.com con autenticación Bearer.
 *
 * Exporta:
 *   isOllamaConfigured()
 *   getOllamaSettings()
 *   saveOllamaSettings(patch)
 *   requestOllamaChatReply(payload, onChunk?)  → string | null
 *   requestOllamaNeuronAction(payload)         → OllamaNeuroAction | null
 */

const SETTINGS_KEY = "memorycarl_ollama_settings";
const OLLAMA_CLOUD_BASE = "https://ollama.com";
const DEFAULT_TIMEOUT_MS = 30_000;

// ---- Modelos disponibles en Ollama Cloud ----
export const OLLAMA_CLOUD_MODELS = [
  { id: "gpt-oss:120b", label: "GPT-OSS 120B (Recomendado)" },
  { id: "qwen3.5", label: "Qwen 3.5" },
  { id: "kimi-k2.6", label: "Kimi K2.6" },
  { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
  { id: "minimax-m3", label: "MiniMax M3" },
  { id: "glm-5.1", label: "GLM 5.1" },
];

export const DEFAULT_OLLAMA_SETTINGS = {
  enabled: false,
  apiKey: "",
  model: "gpt-oss:120b",
  baseUrl: OLLAMA_CLOUD_BASE,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  stream: true,
  temperature: 0.7,
  maxTokens: 2048,
};

// ---- Settings ----

/**
 * Lee los settings de Ollama desde localStorage.
 * @returns {typeof DEFAULT_OLLAMA_SETTINGS}
 */
export function getOllamaSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== "object") return { ...DEFAULT_OLLAMA_SETTINGS };
    return { ...DEFAULT_OLLAMA_SETTINGS, ...parsed };
  } catch (_e) {
    return { ...DEFAULT_OLLAMA_SETTINGS };
  }
}

/**
 * Guarda un patch parcial de los settings de Ollama.
 * @param {Partial<typeof DEFAULT_OLLAMA_SETTINGS>} patch
 * @returns {typeof DEFAULT_OLLAMA_SETTINGS}
 */
export function saveOllamaSettings(patch) {
  const current = getOllamaSettings();
  const updated = { ...current, ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn("[ollamaClient] Error guardando settings:", e);
    throw e;
  }
  return updated;
}

/**
 * Verifica si Ollama está configurado y habilitado.
 * @returns {boolean}
 */
export function isOllamaConfigured() {
  const s = getOllamaSettings();
  return Boolean(s.enabled && s.apiKey && s.apiKey.trim().length > 10);
}

// ---- System prompt para NeuroChat ----

const NEUROCHAT_SYSTEM_PROMPT = `Eres Carl, una inteligencia personal con memoria contextual. Tienes acceso al grafo mental del usuario: neuronas (conceptos, patrones y creencias aprendidas), insights y memorias relevantes.

REGLAS DE COMPORTAMIENTO:
- Responde de forma cercana, directa y con profundidad. No uses tono robótico.
- No des consejos moralistas ni actúes como terapeuta.
- Basa tu respuesta en el contexto neuronal provisto. No inventes recuerdos.
- Si detectas patrones en el usuario, menciónalos con naturalidad.
- Distingue entre patrones actuales vs históricos.
- Si el contexto es insuficiente, responde honestamente sin fabricar.

GESTIÓN DE NEURONAS (al final de tu respuesta, separado por ---NEURON_ACTIONS---):
Después de responder, indica qué acciones tomar sobre el grafo neuronal. Usa este formato JSON estricto:
{
  "actions": [
    {
      "type": "create",
      "neuron": {
        "type": "pattern",
        "core": { "concept": "...", "domain": "...", "summary": "..." },
        "triggers": ["trigger1", "trigger2"],
        "emotion": "neutral",
        "evidence": "Por qué crear esta neurona"
      }
    },
    {
      "type": "update",
      "neuronId": "id-de-neurona-existente",
      "changes": { "core.summary": "nuevo summary", "triggers": ["nuevo_trigger"] }
    },
    {
      "type": "merge",
      "sourceId": "id-neurona-fuente",
      "targetId": "id-neurona-destino",
      "reason": "Son el mismo concepto"
    }
  ]
}

Si no hay acciones necesarias, devuelve: { "actions": [] }
IMPORTANTE: El JSON de acciones debe ir SIEMPRE al final, después de ---NEURON_ACTIONS---. El texto antes de esa línea es tu respuesta conversacional.`;

// ---- Construcción del payload ----

/**
 * Construye el array de mensajes para la API de Ollama.
 * @param {object} payload
 * @returns {object[]}
 */
function buildMessages({ userInput, context = [], history = [], insights = [], temporalContext = null, dayContext = null, memoryRecall = [] }) {
  const messages = [];

  // System message con las instrucciones y el contexto neuronal
  let systemContent = NEUROCHAT_SYSTEM_PROMPT;

  if (context.length > 0) {
    systemContent += "\n\n## CONTEXTO NEURONAL ACTIVO\n";
    context.forEach((c) => {
      systemContent += `- [${c.domain || "general"}] **${c.concept}** (relevancia: ${Math.round((c.score || 0) * 100)}%): ${c.summary || ""}\n`;
    });
  }

  if (insights && insights.length > 0) {
    systemContent += "\n## INSIGHTS DETECTADOS\n";
    insights.slice(0, 4).forEach((i) => {
      systemContent += `- ${i.summary || i.text || ""} (confianza: ${Math.round((i.confidence || 0) * 100)}%)\n`;
    });
  }

  if (temporalContext) {
    systemContent += `\n## CONTEXTO TEMPORAL\nOrientación: ${temporalContext.orientation || "presente"}`;
    if (temporalContext.trendSignals?.length > 0) {
      systemContent += `\nTendencias: ${temporalContext.trendSignals.join("; ")}`;
    }
  }

  if (dayContext && dayContext.length > 0) {
    systemContent += "\n## DÍAS RELEVANTES\n";
    dayContext.slice(0, 2).forEach((d) => {
      systemContent += `- ${d.date}: ${d.summary || ""} (emoción: ${d.emotion || "neutral"})\n`;
    });
  }

  if (memoryRecall && memoryRecall.length > 0) {
    systemContent += "\n## MEMORIAS RECORDADAS\n";
    memoryRecall.slice(0, 3).forEach((m) => {
      systemContent += `- **${m.memory?.title || "Memoria"}**: ${m.snippet || ""}\n`;
    });
  }

  messages.push({ role: "system", content: systemContent });

  // Historial de conversación (últimos 8 turnos)
  const recentHistory = (history || []).slice(-8);
  for (const msg of recentHistory) {
    if (msg.role === "user" || msg.role === "assistant") {
      // Para el historial del asistente, solo el texto de respuesta (sin acciones)
      let content = String(msg.content || "");
      if (msg.role === "assistant" && content.includes("---NEURON_ACTIONS---")) {
        content = content.split("---NEURON_ACTIONS---")[0].trim();
      }
      messages.push({ role: msg.role, content });
    }
  }

  // Mensaje actual del usuario
  messages.push({ role: "user", content: userInput });

  return messages;
}

// ---- Parseo de la respuesta ----

/**
 * Separa el texto conversacional de las acciones de neuronas.
 * @param {string} fullText
 * @returns {{ reply: string, rawActions: string | null }}
 */
function splitReplyAndActions(fullText) {
  const separator = "---NEURON_ACTIONS---";
  const idx = fullText.indexOf(separator);
  if (idx === -1) {
    return { reply: fullText.trim(), rawActions: null };
  }
  return {
    reply: fullText.slice(0, idx).trim(),
    rawActions: fullText.slice(idx + separator.length).trim(),
  };
}

/**
 * Parsea el JSON de acciones de neuronas desde la respuesta del modelo.
 * @param {string | null} rawActions
 * @returns {{ actions: object[] }}
 */
export function parseNeuronActions(rawActions) {
  if (!rawActions) return { actions: [] };
  try {
    // Extraer JSON aunque venga con markdown ```json ... ```
    const jsonMatch = rawActions.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { actions: [] };
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed.actions)) return { actions: [] };
    return { actions: parsed.actions };
  } catch (_e) {
    console.warn("[ollamaClient] No se pudo parsear neuron actions:", rawActions.slice(0, 200));
    return { actions: [] };
  }
}

// ---- Llamada principal con streaming ----

/**
 * Realiza una llamada al chat de Ollama Cloud con soporte de streaming.
 *
 * @param {object} payload — contexto neuronal completo
 * @param {function|null} onChunk — callback(text) llamado en cada fragmento de streaming
 * @returns {Promise<{ reply: string, neuronActions: { actions: object[] } } | null>}
 */
export async function requestOllamaChatReply(payload, onChunk = null) {
  const settings = getOllamaSettings();

  if (!isOllamaConfigured()) {
    console.warn("[ollamaClient] No configurado (apiKey o enabled faltante).");
    return null;
  }

  const messages = buildMessages(payload);
  const useStream = settings.stream && typeof onChunk === "function";
  const baseUrl = (settings.baseUrl || OLLAMA_CLOUD_BASE).replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  const body = {
    model: settings.model || "gpt-oss:120b",
    messages,
    stream: useStream,
    options: {
      temperature: settings.temperature ?? 0.7,
      num_predict: settings.maxTokens ?? 2048,
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errData = await res.json();
        errMsg = errData?.error || errMsg;
      } catch (_e) {}
      console.error(`[ollamaClient] Error en Ollama Cloud: ${errMsg}`);
      return null;
    }

    let fullText = "";

    if (useStream) {
      // Streaming: leer el ReadableStream línea a línea (NDJSON)
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || ""; // la última línea puede estar incompleta

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const chunk = JSON.parse(trimmed);
            const token = chunk?.message?.content || "";
            if (token) {
              fullText += token;
              // Solo pasar al UI el texto conversacional (antes del separador de acciones)
              const displayText = fullText.includes("---NEURON_ACTIONS---")
                ? fullText.split("---NEURON_ACTIONS---")[0]
                : fullText;
              onChunk(displayText);
            }
            if (chunk?.done) break;
          } catch (_parseErr) {
            // Línea no-JSON, ignorar
          }
        }
      }
    } else {
      // Sin streaming: respuesta completa
      const data = await res.json();
      fullText = data?.message?.content || data?.response || "";
    }

    if (!fullText) {
      console.warn("[ollamaClient] Respuesta vacía de Ollama Cloud.");
      return null;
    }

    const { reply, rawActions } = splitReplyAndActions(fullText);
    const neuronActions = parseNeuronActions(rawActions);

    return { reply, neuronActions };
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      console.error("[ollamaClient] Timeout alcanzado.");
    } else {
      console.error("[ollamaClient] Error de red:", err);
    }
    return null;
  }
}

/**
 * Versión simplificada para generación de neuronas sin streaming.
 * Usado como alternativa a Gemini premium para generación.
 *
 * @param {object} payload
 * @returns {Promise<object[]>} array de neuronas generadas
 */
export async function requestOllamaNeuronGeneration(payload) {
  const settings = getOllamaSettings();
  if (!isOllamaConfigured()) return [];

  const { userInput, activatedNeurons = [], missingAnalysis = {} } = payload;

  const activatedSummary = activatedNeurons
    .slice(0, 5)
    .map((r) => {
      const n = r.neuron || r;
      return `- [${n.type}] ${n.core?.concept || ""} (${n.core?.domain || "general"}): ${n.core?.summary || ""}`;
    })
    .join("\n");

  const missingList = (missingAnalysis?.missingConcepts || []).slice(0, 8).join(", ") || "(ninguno)";

  const prompt = `Eres un sistema de memoria personal. Detecta patrones, creencias o hábitos de alto valor que deberían memorizarse.

Input del usuario: ${userInput}

Neuronas activas:
${activatedSummary || "(ninguna)"}

Conceptos no cubiertos: ${missingList}

Devuelve SOLO JSON válido (sin markdown):
{
  "neurons": [
    {
      "type": "pattern",
      "core": { "concept": "...", "domain": "...", "summary": "..." },
      "triggers": ["trigger1", "trigger2"],
      "emotion": "neutral",
      "evidence": "..."
    }
  ]
}

Máximo 3 neuronas. Si no hay información valiosa, devuelve { "neurons": [] }.`;

  const baseUrl = (settings.baseUrl || OLLAMA_CLOUD_BASE).replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model || "gpt-oss:120b",
        messages: [{ role: "user", content: prompt }],
        stream: false,
        options: { temperature: 0.3, num_predict: 1024 },
      }),
    });

    if (!res.ok) return [];
    const data = await res.json();
    const text = data?.message?.content || data?.response || "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    return Array.isArray(parsed.neurons) ? parsed.neurons : [];
  } catch (_e) {
    console.warn("[ollamaClient] Neuron generation falló:", _e);
    return [];
  }
}
