/**
 * shoppingAi.js — Asistente Chef AI para la sección de Compras
 * Usa el mismo cliente Ollama Cloud que NeuroChat.
 * Moneda: Soles peruanos (S/)
 */

import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Construye el system prompt con la biblioteca real de productos del usuario.
 * @param {object[]} products — state.products
 * @param {object[]} chatHistory
 * @returns {string}
 */
function buildChefSystemPrompt(products, chatHistory) {
  // Format the library with all available data
  const libStr = products.length > 0
    ? products.map(p => {
        const unit = p.unit || "u";
        const unitLabel = unit.toLowerCase().includes("kg") ? "/kg" : "/unidad";
        return `- ${p.name}${p.category ? ` [${p.category}]` : ""}: S/ ${Number(p.price || 0).toFixed(2)}${unitLabel}`;
      }).join("\n")
    : "  (Biblioteca vacía — el usuario aún no ha registrado productos)";

  // Calculate food frequency from chat history
  const foodMentions = {};
  chatHistory.forEach(msg => {
    if (msg.role === "user") {
      const content = msg.content.toLowerCase();
      products.forEach(p => {
        if (content.includes(p.name.toLowerCase())) {
          foodMentions[p.name] = (foodMentions[p.name] || 0) + 1;
        }
      });
    }
  });

  const freqLines = Object.entries(foodMentions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => `  - ${name}: ${count} ${count === 1 ? "vez" : "veces"} en el historial`);

  const freqStr = freqLines.length > 0
    ? `\n--- FRECUENCIA DE ALIMENTOS (historial) ---\n${freqLines.join("\n")}\n-------------------------------------------\n`
    : "";

  return `Eres "Chef AI", el asistente personal de cocina, compras y nutrición de Carlos, que vive en Perú.
La moneda es siempre SOLES PERUANOS (S/). Nunca uses dólares.

Tienes acceso a la biblioteca de productos de Carlos con sus precios reales del supermercado:

--- BIBLIOTECA DE PRODUCTOS (${products.length} productos) ---
${libStr}
--------------------------------------------------------------
${freqStr}
TU COMPORTAMIENTO:

1. **Registro de comidas:** Cuando Carlos te diga qué comió, registra la información y calcula el costo aproximado usando los precios de la biblioteca (en S/). Indica el costo estimado de cada comida y el total del día si ya tienes varios registros.

2. **Si no sabes la cantidad exacta:** PREGUNTA. Ejemplo: si dice "Comí huevos", pregunta "¿Cuántos huevos? ¿Los compraste en Mass o en otro lado?" Si el precio no está en la biblioteca, estima o pregunta cuánto pagó.

3. **Seguimiento de frecuencia:** Llevas cuenta de cuántas veces Carlos come lo mismo. Coméntalo naturalmente: "Esta semana ya es la tercera vez que desayunas huevos y pan".

4. **Sugerencias inteligentes:** Cuando Carlos te pida ajustar su gasto, sugiere combinaciones de comidas económicas usando los productos que YA tiene en su biblioteca. Compara opciones por costo.

5. **Ayuda proactiva:** Si notas que Carlos come siempre lo mismo y el costo es alto, sugiérele alternativas más económicas de la biblioteca. Si le falta variedad de nutrientes, coméntalo.

6. **Tono:** Responde en español, de forma amigable, directa y concisa. Eres como un amigo que sabe de cocina y de presupuesto. No seas robot ni uses frases formales.

IMPORTANTE: 
- Usa SIEMPRE S/ para los precios, nunca $
- Si te preguntan algo que no tiene que ver con comida, compras o nutrición, redirige amablemente la conversación.`;
}

/**
 * Envía un mensaje al Chef AI usando Ollama Cloud (igual que NeuroChat).
 * @param {string} text — Mensaje del usuario
 * @param {object[]} chatHistory — Historial completo [{role, content}]
 * @param {object[]} products — state.products (biblioteca de productos)
 * @returns {Promise<object[]>} — Nuevo historial con la respuesta del asistente
 */
export async function sendShoppingAiMessage(text, chatHistory, products) {
  if (!text || !text.trim()) return chatHistory;

  if (!isOllamaConfigured()) {
    throw new Error("Ollama Cloud no está configurado. Ve a NeuroChat → ⚙️ Configuración y activa Ollama con tu API Key.");
  }

  const settings = getOllamaSettings();
  const baseUrl = (settings.baseUrl || "https://ollama.com").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  const systemPrompt = buildChefSystemPrompt(products, chatHistory);

  // Add user message
  const userMsg = { role: "user", content: text.trim() };
  const newHistory = [...chatHistory, userMsg];

  // Build messages for API (last 14 turns to keep context rich)
  const recentHistory = newHistory.slice(-14);
  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map(m => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: m.content
    }))
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

    return [...newHistory, { role: "assistant", content: aiText }];

  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") {
      throw new Error("La solicitud tardó demasiado. Revisa tu conexión e intenta de nuevo.");
    }
    throw err;
  }
}
