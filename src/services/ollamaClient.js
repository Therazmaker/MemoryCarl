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

REGLAS DE COMPORTAMIENTO Y CONVERSACIÓN:
- Eres un compañero de conversación. Actúa con curiosidad y empatía. No uses tono robótico ni moralista.
- Basa tu respuesta en el contexto neuronal provisto. No inventes recuerdos.
- CRÍTICO: Cuando bases tu respuesta en el contexto neuronal o memorias provistas, menciónalo explícitamente y de forma natural (ej. "Recuerdo que mencionaste que...", "Según lo que sé de tu gusto por..."). Esto es vital para que el usuario sepa que estás usando tu memoria.
- CRÍTICO: Sé proactivo al aprender. Si el usuario te da un dato nuevo sobre sí mismo, no des vueltas preguntando. Genera inmediatamente la acción "consolidate" para guardar la neurona y menciona en tu respuesta que acabas de aprender o tomar nota de eso.
- Si el usuario dice algo vago (ej: "Tuve un mal día"), haz UNA sola pregunta clara para explorar.
- Si notas patrones similares en el pasado (basado en neuronas activas), menciónalos.

GESTIÓN DE NEURONAS E INTENCIÓN (al final de tu respuesta, separado por ---NEURON_ACTIONS---):
Después de responder, indica tu intención conversacional y qué acciones tomar sobre el grafo. Usa este formato JSON estricto:
{
  "intent": "clarify|explore|respond|consolidate",
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
    }
  ]
}

Significado de intent:
- clarify: El input es muy vago, hiciste una pregunta corta para entender.
- explore: El usuario dio info nueva pero ambigua, estás profundizando.
- respond: Respuesta normal, usando contexto pasado.
- consolidate: El usuario dio información útil y estás creando/actualizando neuronas. ÚSALO FRECUENTEMENTE.

Si no hay acciones necesarias, devuelve: { "intent": "respond", "actions": [] }
IMPORTANTE: El JSON de acciones debe ir SIEMPRE al final, después de ---NEURON_ACTIONS---. El texto antes de esa línea es tu respuesta conversacional.`;

// ---- Construcción del payload ----

/**
 * Construye el array de mensajes para la API de Ollama.
 * @param {object} payload
 * @returns {object[]}
 */
function buildMessages({ userInput, context = [], history = [], insights = [], temporalContext = null, dayContext = null, memoryRecall = [], conversationSession = null }) {
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

  if (conversationSession) {
    systemContent += `\n## ESTADO DE CONVERSACIÓN\n`;
    systemContent += `- Última intención: ${conversationSession.intent || "none"}\n`;
    if (conversationSession.clarifyCount > 0) {
      systemContent += `- Advertencia: Llevas ${conversationSession.clarifyCount} turnos haciendo preguntas. Considera responder o consolidar información para evitar fatigar al usuario.\n`;
    }
  }

  // ---- ESTADO ACTUAL DEL USUARIO (desde window.state) ----
  try {
    const s = (typeof window !== 'undefined' && window.state) ? window.state : null;
    if (s) {
      const statusParts = [];

      // --- Sueño (última entrada del sleepLog) ---
      const sleepLog = Array.isArray(s.sleepLog) ? s.sleepLog : [];
      const lastSleep = sleepLog.length > 0 ? sleepLog[sleepLog.length - 1] : null;
      if (lastSleep) {
        const hrs = lastSleep.hours ?? lastSleep.h ?? lastSleep.sleepHours ?? null;
        const qual = lastSleep.quality || lastSleep.feel || null;
        const sleepDate = lastSleep.date || lastSleep.dateStr || '';
        if (hrs != null) statusParts.push(`🌙 Último sueño (${sleepDate}): ${hrs}h${qual ? `, sensación: ${qual}` : ''}`);
      }

      // --- Ánimo del día (moodDaily) ---
      const mood = s.moodDaily;
      if (mood) {
        const todayKey = new Date().toISOString().split('T')[0];
        const todayMood = (typeof mood === 'object' && mood[todayKey]) ? mood[todayKey] : null;
        if (todayMood) {
          const val = todayMood.value || todayMood.mood || todayMood.label || todayMood;
          statusParts.push(`😊 Estado de ánimo hoy: ${val}`);
        }
      }

      // --- Finanzas básicas ---
      const accounts = Array.isArray(s.finance_accounts) ? s.finance_accounts : [];
      const ledger = Array.isArray(s.finance_ledger) ? s.finance_ledger : [];
      if (accounts.length > 0) {
        const totalBalance = accounts.reduce((sum, a) => sum + (Number(a.balance) || 0), 0);
        statusParts.push(`💰 Balance financiero total: ${totalBalance.toFixed(2)}`);
      }
      if (ledger.length > 0) {
        // Gastos de los últimos 7 días
        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
        const recentExpenses = ledger.filter(t => {
          const ts = t.date ? new Date(t.date).getTime() : 0;
          return ts >= sevenDaysAgo && (t.type === 'expense' || t.amount < 0);
        });
        const totalExpenses = recentExpenses.reduce((sum, t) => sum + Math.abs(Number(t.amount) || 0), 0);
        if (totalExpenses > 0) statusParts.push(`📉 Gastos últimos 7 días: ${totalExpenses.toFixed(2)}`);
      }

      // --- Rutinas pendientes ---
      const routines = Array.isArray(s.routines) ? s.routines : [];
      const pendingRoutines = routines.filter(r => !r.done && !r.completed);
      if (pendingRoutines.length > 0) {
        statusParts.push(`📋 Rutinas pendientes hoy: ${pendingRoutines.length} (${pendingRoutines.slice(0,3).map(r => r.name || r.title || r.label || '?').join(', ')})`);
      }

      // --- Tarot Diario ---
      const tarotLog = Array.isArray(s.tarotLog) ? s.tarotLog : [];
      const todayIso = new Date().toISOString().split('T')[0];
      const todayTarots = tarotLog.filter(t => t.dateIso === todayIso);
      if (todayTarots.length > 0) {
        const lastTarot = todayTarots[todayTarots.length - 1];
        statusParts.push(`🔮 Lectura de Tarot de hoy: Preguntó "${lastTarot.question || "Lectura general"}". Salieron: ${(lastTarot.cards||[]).join(", ")}.`);
      }

      if (statusParts.length > 0) {
        systemContent += '\n\n## ESTADO ACTUAL DEL USUARIO\nEsta información es en tiempo real. Úsala para contextualizar tus respuestas de forma natural y empática:\n';
        statusParts.forEach(p => { systemContent += `- ${p}\n`; });
        systemContent += '\nIMPORTANTE: Si el usuario habla de cansancio, energía o ánimo, conecta tu respuesta con estos datos reales. Si habla de gastos o dinero, menciona su situación financiera actual.';
      }
    }
  } catch (_e) { /* silencioso */ }

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

/**
 * Pide a Ollama que revise y mejore la redacción de una memoria existente.
 */
export async function enhanceMemoryWithOllama(memory) {
  const settings = getOllamaSettings();
  if (!isOllamaConfigured()) throw new Error("Ollama no está configurado");

  const prompt = `Eres un asistente experto en redacción y memoria personal. 
Tu tarea es mejorar la redacción de una memoria personal para que sea más clara, concisa y profunda, preservando los hechos y la emoción original. 
También debes sugerir etiquetas (tags) útiles.

MEMORIA ACTUAL:
Título: ${memory.title || "Sin título"}
Texto: ${memory.text || ""}
Tags actuales: ${(memory.tags || []).join(", ") || "Ninguno"}

Devuelve SOLO un objeto JSON válido (sin formato markdown \`\`\`json) con esta estructura exacta:
{
  "title": "Un título corto y descriptivo",
  "text": "El texto mejorado, claro y literario pero directo",
  "tags": ["tag1", "tag2", "tag3"]
}`;

  const baseUrl = (settings.baseUrl || OLLAMA_CLOUD_BASE).replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

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
      options: { temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Error de Ollama (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const text = data?.message?.content || data?.response || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  
  if (!jsonMatch) {
    throw new Error("Ollama no devolvió un JSON válido");
  }
  
  return JSON.parse(jsonMatch[0]);
}
