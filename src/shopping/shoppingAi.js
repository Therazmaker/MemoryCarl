/**
 * shoppingAi.js — Asistente Chef AI para la sección de Compras
 * Usa el mismo cliente Ollama Cloud que NeuroChat.
 * Moneda: Soles peruanos (S/)
 */

import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";
import { formatProductForAiPrompt, enrichAllProducts } from "./productIntelligence.js";
import { formatMealInventoryForAiPrompt } from "./mealBundles.js";

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
function buildChefSystemPrompt(products, chatHistory, pastDays = [], inventory = [], financeContext = null) {
  const enrichedProducts = enrichAllProducts(products);
  const libStr = enrichedProducts.length > 0
    ? enrichedProducts.map(p => formatProductForAiPrompt(p)).join("\n")
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

  const mealBundlesStr = formatMealInventoryForAiPrompt();

  let financeStr = "";
  if (financeContext) {
    financeStr = `
--- SITUACIÓN FINANCIERA ACTUAL (Solo lectura - Tú NO descuentas dinero) ---
- Saldo total disponible: S/ ${financeContext.totalBalance.toFixed(2)}
- Ciclo de cobro: ${financeContext.runway?.label || "15 y fin de mes"} (quedan ${financeContext.runway?.daysRemaining || 0} días)
- Margen libre diario: S/ ${financeContext.dailyFreeBudget.toFixed(2)} / día
- Salud de liquidez: ${financeContext.liquidityHealth?.toUpperCase() || "MODERADO"}
--------------------------------------------------------------------------`;
  }

  return `Eres "Chef AI", el estratega personal de cocina, hábitos y alimentación de Carlos en Perú.
La moneda es siempre SOLES PERUANOS (S/). Nunca uses dólares.
${financeStr}

--- BIBLIOTECA DE PRODUCTOS (${products.length} productos con precios base y gustos) ---
${libStr}
--------------------------------------------------------------
--- TU INVENTARIO ACTUAL EN CASA (Despensa) ---
${invStr}
--------------------------------------------------------------
--- COMIDAS CASERAS PREPARADAS EN CASA (Meal Bundles & Porciones) ---
${mealBundlesStr}
--------------------------------------------------------------
${pastCtx}${freqStr}
TU COMPORTAMIENTO:

1. **Visibilidad Financiera (NO descuentes dinero):**
   - Conoces el saldo y el margen diario de Carlos para darle recomendaciones inteligentes según su liquidez.
   - Carlos se encarga de sus finanzas manualmente, así que NUNCA intentes crear débitos o transacciones monetarias automáticas.

2. **Cerebro y Aprendizaje Continuo (NIVEL DIOS):**
   - Cuando Carlos te cuente qué desayunó, almorzó o compró (ej. "desayuné 2 empanadas a 3 soles" o "compré 4 soles de pollo y 2 de arroz"), aprende y actualiza su base de conocimiento.
   - Si menciona un producto que no está en la biblioteca o actualiza precios/preferencias, genera una acción en JSON para guardarlo.
   - Si cocinó para varios días, genera un \`createMealBundle\` con porciones estimadas.
   - Si consumió comida casera guardada, genera un \`consumeMealBundle\`.

3. **Matemática Fraccional y Comidas:**
   - Calcula el costo real de su comida fraccionada (ej. si comió parte de lo que tenía en despensa).

4. **Acciones JSON (Al final de tu respuesta):**
   Pon el bloque JSON al final si aprendiste algo nuevo o si hay comidas/porciones que actualizar:
   ---ACTIONS---
   {
     "learnProduct": {
       "name": "Empanadas",
       "price": 3.00,
       "rating": 4,
       "context": "calle_rapida",
       "tier": "gusto_medio"
     },
     "createMealBundle": {
       "name": "Almuerzo: Pollo con Arroz",
       "mealType": "almuerzo",
       "totalCost": 6.00,
       "portions": 2,
       "notes": "Preparado en casa"
     },
     "consumeMealBundle": {
       "mealType": "almuerzo"
     }
   }

5. **Tono:** Amigable, cercano, analítico. Un chef y copiloto de hábitos que aprende de cada comida de Carlos.`;
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
 * @param {object} [financeContext] — liquidez y margen diario
 * @returns {Promise<object[]>} — updated chat history
 */
export async function sendShoppingAiMessage(text, chatHistory, products, pastDays = [], inventory = [], financeContext = null) {
  if (!text || !text.trim()) return chatHistory;

  const systemPrompt = buildChefSystemPrompt(products, chatHistory, pastDays, inventory, financeContext);
  const userMsg = { role: "user", content: text.trim(), ts: new Date().toISOString() };
  const newHistory = [...chatHistory, userMsg];

  const recentHistory = newHistory.slice(-14);
  const messages = [
    { role: "system", content: systemPrompt },
    ...recentHistory.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }))
  ];

  let aiText = await callOllama(messages);
  
  // Extract actions if present
  let extractedActions = null;
  const splitIdx = aiText.indexOf("---ACTIONS---");
  if (splitIdx !== -1) {
    const rawActions = aiText.substring(splitIdx + 13).trim();
    aiText = aiText.substring(0, splitIdx).trim();
    try {
      extractedActions = JSON.parse(rawActions);
    } catch (e) {
      console.warn("Chef AI returned invalid JSON actions:", rawActions);
    }
  }

  const assistantMsg = { role: "assistant", content: aiText, ts: new Date().toISOString() };
  return { newChat: [...newHistory, assistantMsg], actions: extractedActions };
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
