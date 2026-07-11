/**
 * shoppingAi.js — Asistente Chef AI para la sección de Compras
 * Usa el mismo cliente Ollama Cloud que NeuroChat.
 * Moneda: Soles peruanos (S/)
 */

import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Format date as "Vie 11 Jul" */
export function formatDayLabel(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T12:00:00");
  const days = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

/** Returns today's ISO date string (YYYY-MM-DD) */
export function todayISO() {
  return new Date().toISOString().split("T")[0];
}

/**
 * Build system prompt with product library, inventory + past days context.
 */
function buildChefSystemPrompt(products, chatHistory, pastDays = [], inventory = []) {
  const libStr = products.length > 0
    ? products.map(p => {
        const unit = (p.unit || "u").toLowerCase();
        const unitLabel = unit.includes("kg") ? "kg" : "u";
        return `- ${p.name}${p.category ? ` [${p.category}]` : ""}: S/ ${Number(p.price || 0).toFixed(2)} por ${unitLabel}`;
      }).join("\n")
    : "  (Biblioteca vacía)";

  const invStr = inventory.length > 0
    ? inventory.map(i => {
        const qty = i.qty ? ` (Quedan: ${i.qty})` : "";
        return `  - ${i.name || "Producto"}${qty}`;
      }).join("\n")
    : "  (Despensa vacía o no registrada)";

  // Past days context (last 7 days)
  let pastCtx = "";
  if (pastDays.length > 0) {
    const recent = pastDays.slice(-7);
    pastCtx = "\n--- HISTORIAL DE DÍAS ANTERIORES ---\n";
    recent.forEach(d => {
      const label = formatDayLabel(d.date);
      const notes = d.editedNotes ? `\n  Notas editadas: ${d.editedNotes}` : "";
      const cost = d.estimatedCost ? ` · S/ ${Number(d.estimatedCost).toFixed(2)} est.` : "";
      pastCtx += `${label}${cost}: ${d.summary || "(sin resumen)"}${notes}\n`;
    });
    pastCtx += "------------------------------------\n";
  }

  // Food frequency from history + past days
  const foodMentions = {};
  const allUserMessages = [
    ...chatHistory.filter(m => m.role === "user"),
    ...pastDays.flatMap(d => (d.messages || []).filter(m => m.role === "user"))
  ];
  allUserMessages.forEach(msg => {
    const content = msg.content.toLowerCase();
    products.forEach(p => {
      if (content.includes(p.name.toLowerCase())) {
        foodMentions[p.name] = (foodMentions[p.name] || 0) + 1;
      }
    });
  });
  const freqLines = Object.entries(foodMentions)
    .sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([name, count]) => `  - ${name}: ${count} ${count === 1 ? "vez" : "veces"}`);
  const freqStr = freqLines.length > 0
    ? `\n--- FRECUENCIA HISTÓRICA ---\n${freqLines.join("\n")}\n----------------------------\n`
    : "";

  return `Eres "Chef AI", el asistente personal de cocina, compras y nutrición de Carlos, en Perú.
La moneda es siempre SOLES PERUANOS (S/). Nunca uses dólares.

--- BIBLIOTECA DE PRODUCTOS (${products.length} productos con precios base) ---
${libStr}
--------------------------------------------------------------
--- TU INVENTARIO ACTUAL EN CASA (Despensa) ---
${invStr}
--------------------------------------------------------------
${pastCtx}${freqStr}
TU COMPORTAMIENTO:

1. **Sugerencias con Inventario:** Usa los productos que Carlos YA TIENE en su Despensa para sugerirle comidas económicas. Así gastará S/ 0 extra.

2. **Matemática Fraccional (MUY IMPORTANTE):**
   - En la biblioteca, los precios están por unidad completa o por kilogramo (kg).
   - Si la biblioteca dice "Arroz: S/ 4.00 por kg" y Carlos dice "Comí 250g de arroz", **debes calcular la fracción**: (250g / 1000g) * S/ 4.00 = S/ 1.00.
   - Si la biblioteca dice "Huevos: S/ 15.00 por u" (asumiendo que es una plancha de 30) y él come 2 huevos, haz un estimado razonable del costo unitario.
   - Suma estos costos fraccionados para darle el costo REAL de su comida, no el precio del paquete entero.

3. **Registro de comidas:** Cuando Carlos diga qué comió, calcula el costo aproximado en S/ aplicando la matemática fraccional. Indica el costo de cada ingrediente, el total de la comida y el acumulado del día.

4. **Pregunta cantidades:** Si Carlos dice "comí arroz", pregunta cuántos gramos o qué porción. Para ser exactos necesitas saber la fracción del producto que usó.

5. **Seguimiento de frecuencia:** Usa el historial de días anteriores para detectar patrones ("Esta semana ya es la tercera vez que cenas eso").

6. **Tono:** Español, amigable, directo. Como un amigo chef que también sabe de finanzas y cálculo rápido.`;
}

/**
 * Llama a Ollama Cloud (igual que NeuroChat) para responder al usuario.
 */
async function callOllama(messages) {
  if (!isOllamaConfigured()) {
    throw new Error("Ollama Cloud no configurado. Ve a NeuroChat → ⚙️ Configuración y activa Ollama con tu API Key.");
  }
  const settings = getOllamaSettings();
  const baseUrl = (settings.baseUrl || "https://ollama.com").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  const body = {
    model: settings.model || "gpt-oss:120b",
    messages,
    stream: false,
    options: { temperature: settings.temperature ?? 0.7, num_predict: settings.maxTokens ?? 1024 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs || DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try { const e = await res.json(); errMsg = e?.error || errMsg; } catch (_) {}
      throw new Error(`Error Ollama Cloud: ${errMsg}`);
    }
    const data = await res.json();
    return data?.message?.content || "";
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Tiempo de espera agotado. Revisa tu conexión.");
    throw err;
  }
}

/**
 * Envía un mensaje al Chef AI.
 * @param {string} text
 * @param {object[]} chatHistory — today's chat
 * @param {object[]} products — state.products
 * @param {object[]} pastDays — state.shoppingAiDays
 * @param {object[]} inventory — state.inventory
 * @returns {Promise<object[]>} — updated chat history
 */
export async function sendShoppingAiMessage(text, chatHistory, products, pastDays = [], inventory = []) {
  if (!text || !text.trim()) return chatHistory;

  const systemPrompt = buildChefSystemPrompt(products, chatHistory, pastDays, inventory);
  const userMsg = { role: "user", content: text.trim(), ts: new Date().toISOString() };
  const newHistory = [...chatHistory, userMsg];

  const recentHistory = newHistory.slice(-14);
  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
  ];

  const aiText = await callOllama(messages);
  const assistantMsg = { role: "assistant", content: aiText, ts: new Date().toISOString() };
  return [...newHistory, assistantMsg];
}

/**
 * Genera un resumen del día al cerrarlo.
 * Extrae: resumen narrativo + costo estimado total.
 * @param {object[]} chatHistory — today's full chat
 * @param {object[]} products
 * @returns {Promise<{ summary: string, estimatedCost: number }>}
 */
export async function generateDaySummary(chatHistory, products) {
  const libStr = products.slice(0, 30).map(p =>
    `- ${p.name}: S/ ${Number(p.price || 0).toFixed(2)}`
  ).join("\n");

  const chatStr = chatHistory.map(m =>
    `${m.role === "user" ? "Carlos" : "Chef AI"}: ${m.content}`
  ).join("\n");

  const prompt = `Eres un asistente de nutrición y finanzas. Analiza esta conversación del día entre Carlos y su Chef AI:

--- CONVERSACIÓN ---
${chatStr}
-------------------

--- PRECIOS DE REFERENCIA ---
${libStr}
----------------------------

Genera un resumen conciso del día con este formato EXACTO (en español, máximo 3 líneas):
RESUMEN: [qué comió Carlos durante el día, desayuno/almuerzo/cena si se mencionan]
COSTO_ESTIMADO: [número decimal solo, sin S/, representando el costo total estimado del día en soles]

Si no hay suficiente información para calcular el costo, pon 0.`;

  const messages = [
    { role: "system", content: "Eres un asistente que genera resúmenes concisos de diarios de alimentación. Responde SOLO con el formato solicitado." },
    { role: "user", content: prompt }
  ];

  try {
    const raw = await callOllama(messages);
    const summaryMatch = raw.match(/RESUMEN:\s*(.+)/);
    const costMatch = raw.match(/COSTO_ESTIMADO:\s*([\d.]+)/);

    const summary = summaryMatch ? summaryMatch[1].trim() : raw.trim().slice(0, 200);
    const estimatedCost = costMatch ? parseFloat(costMatch[1]) : 0;

    return { summary, estimatedCost };
  } catch (e) {
    return { summary: "Resumen no disponible.", estimatedCost: 0 };
  }
}
