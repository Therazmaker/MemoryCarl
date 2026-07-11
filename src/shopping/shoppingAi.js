/**
 * shoppingAi.js — Asistente Chef AI para la sección de Compras
 * Usa el mismo cliente Ollama Cloud que NeuroChat.
 */

import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Construye el system prompt con la biblioteca de productos del usuario.
 * @param {object[]} library
 * @param {object[]} chatHistory
 * @returns {string}
 */
function buildChefSystemPrompt(library, chatHistory) {
  const libStr = library.length > 0
    ? library.map(p => `- ${p.name}${p.cat ? ` [${p.cat}]` : ""}: $${Number(p.price || 0).toFixed(2)}`).join("\n")
    : "  (Biblioteca vacía — anima al usuario a registrar productos con precios)";

  // Calcular frecuencias de comidas del historial
  const foodMentions = {};
  chatHistory.forEach(msg => {
    if (msg.role === "user") {
      const content = msg.content.toLowerCase();
      library.forEach(p => {
        if (content.includes(p.name.toLowerCase())) {
          foodMentions[p.name] = (foodMentions[p.name] || 0) + 1;
        }
      });
    }
  });
  const freqStr = Object.entries(foodMentions)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `  - ${name}: mencionado ${count} veces`)
    .join("\n");

  return `Eres "Chef AI", el asistente personal de cocina, compras y nutrición de Carlos.
Tienes acceso a su biblioteca de productos con precios reales:

--- BIBLIOTECA DE PRODUCTOS ---
${libStr}
-------------------------------

${freqStr ? `--- FRECUENCIA DE ALIMENTOS (historial de conversación) ---\n${freqStr}\n-------------------------------\n` : ""}

TU OBJETIVO:
1. **Registrar comidas:** Cuando el usuario te diga qué comió (desayuno, almuerzo, cena o merienda), registra la información y calcula el costo aproximado basándote en los precios de la biblioteca. Si un ingrediente no está en la biblioteca, haz una estimación razonable e indícalo claramente.
2. **Seguimiento de patrones:** Llevas cuenta de cuántas veces el usuario ha comido lo mismo. Coméntalo naturalmente cuando sea relevante ("Esta semana ya es la tercera vez que desayunas huevos").
3. **Sugerencias inteligentes:** Con base en lo que hay en su biblioteca y lo que gasta, sugiere combinaciones de comidas económicas y variadas. Ayúdale a planificar si quiere gastar menos.
4. **Ajuste de presupuesto:** Si el usuario te pide ajustar, calcula opciones más baratas usando los productos de su biblioteca.
5. **Idioma y tono:** Responde siempre en español, de forma amigable, directa y sin rodeos. Eres como un amigo chef que también sabe de finanzas.

IMPORTANTE: Siempre calcula costos cuando el usuario registre comidas. Usa los precios reales de la biblioteca.`;
}

/**
 * Envía un mensaje al Chef AI usando el cliente Ollama Cloud (igual que NeuroChat).
 * @param {string} text — Mensaje del usuario
 * @param {object[]} chatHistory — Historial completo [{role, content}]
 * @param {object[]} library — Biblioteca de productos de state.shopping
 * @returns {Promise<object[]>} — Nuevo historial con la respuesta del asistente
 */
export async function sendShoppingAiMessage(text, chatHistory, library) {
  if (!text || !text.trim()) return chatHistory;

  if (!isOllamaConfigured()) {
    throw new Error("Ollama Cloud no está configurado. Ve a NeuroChat → Configuración y agrega tu API Key de Ollama.");
  }

  const settings = getOllamaSettings();
  const baseUrl = (settings.baseUrl || "https://ollama.com").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  const systemPrompt = buildChefSystemPrompt(library, chatHistory);

  // Nuevo mensaje del usuario
  const userMsg = { role: "user", content: text.trim() };
  const newHistory = [...chatHistory, userMsg];

  // Construir mensajes para la API (últimos 12 turnos + system)
  const recentHistory = newHistory.slice(-12);
  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
  ];

  const body = {
    model: settings.model || "gpt-oss:120b",
    messages,
    stream: false,
    options: {
      temperature: settings.temperature ?? 0.7,
      num_predict: settings.maxTokens ?? 1024,
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
      throw new Error(`Error de Ollama Cloud: ${errMsg}`);
    }

    const data = await res.json();
    const aiText = data?.message?.content || "No pude generar una respuesta. Intenta de nuevo.";

    const assistantMsg = { role: "assistant", content: aiText };
    return [...newHistory, assistantMsg];

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado. Revisa tu conexión e intenta de nuevo.");
    }
    throw err;
  }
}
