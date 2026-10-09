/**
 * claudeClient.js — Cliente para Anthropic Claude API en NeuroChat
 * MemoryCarl / NeuroChat
 *
 * Permite usar el modelo Anthropic Claude (e.g. claude-haiku-4-5, claude-3-5-sonnet-20241022)
 * como motor conversacional de NeuroChat, con soporte para activación y gestión
 * dinámica de neuronas vía ---NEURON_ACTIONS---.
 */

import { getNeuroChatSettings } from "../settings/neurochatSettings.js";
import { getChefAiSettings } from "../shopping/shoppingAi.js";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_TIMEOUT_MS = 30_000;

export const CLAUDE_MODELS = [
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Rápido y económico)" },
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet (Avanzado)" },
];

/**
 * Obtiene la configuración de Claude leyendo settings de NeuroChat o heredando de Chef AI.
 */
export function getClaudeSettings() {
  const nc = getNeuroChatSettings();
  let apiKey = nc.claudeApiKey || "";
  let model = nc.claudeModel || "claude-haiku-4-5";

  if (!apiKey) {
    const chef = getChefAiSettings();
    if (chef.claudeApiKey) {
      apiKey = chef.claudeApiKey;
      if (chef.claudeModel) model = chef.claudeModel;
    }
  }

  return {
    apiKey,
    model,
    enabled: nc.enabled ?? true,
  };
}

/**
 * Verifica si Claude está configurado y tiene API key válida.
 */
export function isClaudeConfigured() {
  const settings = getClaudeSettings();
  return Boolean(settings.enabled && settings.apiKey && settings.apiKey.trim().length > 10);
}

const NEUROCHAT_CLAUDE_SYSTEM_PROMPT = `Eres Carl, una inteligencia personal con memoria contextual y un amigo cercano del usuario. Tienes acceso a su grafo mental: neuronas (conceptos, patrones y creencias aprendidas), insights y memorias relevantes.

REGLAS DE COMPORTAMIENTO Y CONVERSACIÓN:
- Eres un compañero de conversación empático, cercano y natural. Actúa como un amigo de verdad. No uses tono robótico, sermoneador ni moralista.
- Si el mensaje del usuario es un saludo casual o charla informal (ej. "hola", "qué tal"), responde amablemente y de forma relajada sin forzar conceptos innecesarios.
- Si el usuario habla de un tema personal, emociones, decisiones, proyectos o hábitos, activa tus recuerdos y demuestra comprensión profunda.
- CRÍTICO: Cuando bases tu respuesta en el contexto neuronal o memorias provistas, menciónalo explícitamente y de forma natural (ej. "Recuerdo que me contaste que...", "Como sé que te gusta..."). Esto es vital para que el usuario sepa que estás usando tu memoria.
- CRÍTICO: Sé proactivo al aprender. Si el usuario te da un dato nuevo sobre sí mismo, o falta contexto sobre algo personal, pregúntale de forma cercana. Cuando te dé la información o te cuente algo relevante, genera inmediatamente acciones para crear o actualizar neuronas y toma nota de eso.
- Si el usuario dice algo vago o incompleto sobre un tema importante, haz UNA sola pregunta clara para explorar más contexto.

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
- clarify: El input es vago, hiciste una pregunta corta para entender mejor.
- explore: El usuario dio info nueva pero ambigua, estás profundizando.
- respond: Respuesta normal o saludo casual, usando o no contexto.
- consolidate: El usuario dio información personal/útil y estás creando o actualizando neuronas. ÚSALO cuando aprendas algo relevante.

Si no hay acciones necesarias, devuelve: { "intent": "respond", "actions": [] }
IMPORTANTE: El JSON de acciones debe ir SIEMPRE al final, después de ---NEURON_ACTIONS---. El texto antes de esa línea es tu respuesta conversacional.`;

/**
 * Construye el prompt de sistema y los mensajes para la API de Claude.
 */
function buildClaudePayload({ userInput, context = [], history = [], insights = [], temporalContext = null, dayContext = null, memoryRecall = [], conversationSession = null }) {
  let systemContent = NEUROCHAT_CLAUDE_SYSTEM_PROMPT;

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
      systemContent += `- Advertencia: Llevas ${conversationSession.clarifyCount} turnos haciendo preguntas. Considera responder o consolidar información.\n`;
    }
  }

  // Estado del usuario en tiempo real
  try {
    const s = (typeof window !== "undefined" && window.state) ? window.state : null;
    if (s) {
      const statusParts = [];
      const sleepLog = Array.isArray(s.sleepLog) ? s.sleepLog : [];
      const lastSleep = sleepLog.length > 0 ? sleepLog[sleepLog.length - 1] : null;
      if (lastSleep) {
        const hrs = lastSleep.hours ?? lastSleep.h ?? lastSleep.sleepHours ?? null;
        const qual = lastSleep.quality || lastSleep.feel || null;
        if (hrs != null) statusParts.push(`🌙 Último sueño: ${hrs}h${qual ? `, sensación: ${qual}` : ""}`);
      }

      const mood = s.moodDaily;
      if (mood) {
        const todayKey = new Date().toISOString().split("T")[0];
        const todayMood = (typeof mood === "object" && mood[todayKey]) ? mood[todayKey] : null;
        if (todayMood) statusParts.push(`😊 Ánimo hoy: ${todayMood.value || todayMood.label || todayMood}`);
      }

      if (statusParts.length > 0) {
        systemContent += "\n\n## ESTADO ACTUAL DEL USUARIO\n";
        statusParts.forEach((p) => { systemContent += `- ${p}\n`; });
      }
    }
  } catch (_e) {}

  const formattedMessages = [];
  const recentHistory = (history || []).slice(-8);
  for (const msg of recentHistory) {
    if (msg.role === "user" || msg.role === "assistant") {
      let content = String(msg.content || "");
      if (msg.role === "assistant" && content.includes("---NEURON_ACTIONS---")) {
        content = content.split("---NEURON_ACTIONS---")[0].trim();
      }
      formattedMessages.push({ role: msg.role === "assistant" ? "assistant" : "user", content });
    }
  }

  formattedMessages.push({ role: "user", content: userInput });

  return { systemContent, messages: formattedMessages };
}

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

export function parseClaudeNeuronActions(rawActions) {
  if (!rawActions) return { actions: [], intent: "respond" };
  try {
    const jsonMatch = rawActions.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { actions: [], intent: "respond" };
    const parsed = JSON.parse(jsonMatch[0]);
    const actions = Array.isArray(parsed.actions) ? parsed.actions : [];
    const intent = parsed.intent || "respond";
    return { actions, intent };
  } catch (_e) {
    console.warn("[claudeClient] No se pudo parsear neuron actions:", rawActions.slice(0, 200));
    return { actions: [], intent: "respond" };
  }
}

/**
 * Pide respuesta a Anthropic Claude API para NeuroChat.
 *
 * @param {object} payload
 * @returns {Promise<{ reply: string, neuronActions: { actions: object[], intent: string }, intent: string } | null>}
 */
export async function requestClaudeChatReply(payload) {
  const settings = getClaudeSettings();

  if (!settings.apiKey) {
    console.warn("[claudeClient] API Key no configurada.");
    return null;
  }

  const { systemContent, messages } = buildClaudePayload(payload);

  const requestBody = {
    model: settings.model || "claude-haiku-4-5",
    max_tokens: 2048,
    system: [
      {
        type: "text",
        text: systemContent,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error?.message || errMsg;
      } catch (_) {}
      console.error(`[claudeClient] Error Anthropic Claude: ${errMsg}`);
      return null;
    }

    const data = await res.json();
    const fullText = data?.content?.[0]?.text;

    if (!fullText) {
      console.warn("[claudeClient] Respuesta vacía de Claude API.");
      return null;
    }

    const { reply, rawActions } = splitReplyAndActions(fullText);
    const { actions, intent } = parseClaudeNeuronActions(rawActions);

    return { reply, neuronActions: { actions, intent }, intent };
  } catch (err) {
    clearTimeout(timer);
    console.error("[claudeClient] Falló solicitud a Claude:", err);
    return null;
  }
}

/**
 * Llama a Anthropic Claude como un Socratic Pattern Weaver para el NeuroProbe.
 *
 * @param {{
 *   context: object,
 *   history: Array<{role: string, content: string}>,
 *   recentMemoriesSummary?: string,
 *   activeNeurons?: Array<object>
 * }} payload
 * @returns {Promise<{ isDraft: boolean, message: string, proposedNeuron?: object }>}
 */
export async function requestClaudeSocraticProbe(payload = {}) {
  const settings = getClaudeSettings();
  if (!settings.apiKey) {
    throw new Error("Claude API Key no configurada para NeuroProbe");
  }

  const { context = {}, history = [], recentMemoriesSummary = "", activeNeurons = [] } = payload;
  const historyText = history.map(h => `${h.role === 'assistant' ? 'Carl' : 'Usuario'}: ${h.content}`).join("\n");

  const activeNeuronsSummary = (activeNeurons || [])
    .slice(0, 6)
    .map(n => `- [${n.core?.domain || "general"}] ${n.core?.concept}: ${n.core?.summary || ""}`)
    .join("\n");

  const systemPrompt = `Eres NeuroProbe, un observador cognitivo socrático e inquisitivo que ayuda al usuario a descubrir patrones, hábitos, creencias o conexiones profundas en su mente.

Contexto cognitivo detectado: ${JSON.stringify(context)}
${recentMemoriesSummary ? `Resumen de memorias/conversaciones recientes:\n${recentMemoriesSummary}\n` : ""}
${activeNeuronsSummary ? `Neuronas activas o relevantes:\n${activeNeuronsSummary}\n` : ""}

REGLAS CRÍTICAS:
1. Tu objetivo es hacer una PREGUNTA SOCRÁTICA PROFUNDA, ESPECÍFICA y ATINADA sobre la vida, decisiones, emociones o patrones del usuario basándote en el contexto reciente y sus neuronas.
2. NUNCA hagas preguntas genéricas, obvias o "random". Conecta directamente con lo que el usuario está viviendo o pensando.
3. Si el usuario está respondiendo a tu pregunta y necesitas explorar más (1-2 turnos): Devuelve "isDraft": false, y en "message" haz una repregunta reflexiva o señálale un patrón intrigante.
4. Si el usuario ya ha revelado una idea, patrón o hábito claro que deba convertirse en neurona: Devuelve "isDraft": true, un "message" empático de conclusión reconociendo el patrón, y completa "proposedNeuron".

FORMATO DE RESPUESTA (Responde ÚNICAMENTE con un objeto JSON válido, sin bloques markdown ni texto adicional):
{
  "isDraft": false,
  "message": "Tu pregunta o repregunta socrática...",
  "proposedNeuron": {
    "type": "pattern",
    "core": { "concept": "nombre claro y conciso del patrón", "domain": "general|work|personal|emotions|etc", "summary": "resumen descriptivo del patrón o creencia" },
    "triggers": ["palabra1", "palabra2"],
    "emotion": "neutral",
    "evidence": ["extracto o evidencia literal expresada por el usuario"]
  }
}`;

  const formattedMessages = [];
  if (historyText) {
    formattedMessages.push({
      role: "user",
      content: `Historial de diálogo del probe:\n${historyText}\n\nAnaliza la última respuesta del usuario y continúa la indagación socrática o formaliza la neurona.`
    });
  } else {
    formattedMessages.push({
      role: "user",
      content: `Genera una pregunta socrática inicial profunda y relevante basada en mi contexto actual.`
    });
  }

  const requestBody = {
    model: settings.model || "claude-haiku-4-5",
    max_tokens: 1024,
    system: [
      {
        type: "text",
        text: systemPrompt,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: formattedMessages,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error?.message || errMsg;
      } catch (_) {}
      throw new Error(`Error Anthropic Claude: ${errMsg}`);
    }

    const data = await res.json();
    const fullText = data?.content?.[0]?.text;

    if (!fullText) {
      throw new Error("Respuesta vacía de Claude API en SocraticProbe");
    }

    let text = fullText.trim();
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (match) text = match[0];

    return JSON.parse(text);
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`Error en requestClaudeSocraticProbe: ${err.message}`);
  }
}
