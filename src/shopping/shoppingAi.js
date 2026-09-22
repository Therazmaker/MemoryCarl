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

const CHEF_SETTINGS_KEY = "memorycarl_chef_settings";

/**
 * Obtiene la configuración para Chef AI (revisa settings propios o hereda de NeuroChat).
 */
export function getChefAiSettings() {
  let chefCustom = {};
  try {
    const raw = localStorage.getItem(CHEF_SETTINGS_KEY);
    if (raw) chefCustom = JSON.parse(raw);
  } catch (_) {}

  // Heredar Gemini si está configurado en NeuroChat
  let geminiKey = chefCustom.geminiApiKey || "";
  let geminiModel = chefCustom.geminiModel || "gemini-2.5-flash";
  if (!geminiKey) {
    try {
      const nc = JSON.parse(localStorage.getItem("memorycarl_neurochat_settings") || "{}");
      if (nc.apiKey) {
        geminiKey = nc.apiKey;
        if (nc.model && nc.model.includes("gemini")) geminiModel = nc.model;
      }
    } catch (_) {}
  }

  // Ollama settings
  const ollama = getOllamaSettings();

  const provider = chefCustom.provider || (geminiKey ? "gemini" : (ollama.apiKey ? "ollama" : "gemini"));

  return {
    provider, // "gemini" | "ollama"
    geminiApiKey: geminiKey,
    geminiModel,
    ollamaModel: chefCustom.ollamaModel || ollama.model || "gemma4:31b",
    ollamaBaseUrl: chefCustom.ollamaBaseUrl || ollama.baseUrl || "https://ollama.com",
    ollamaApiKey: chefCustom.ollamaApiKey || ollama.apiKey || "",
  };
}

/**
 * Guarda ajustes específicos para Chef AI y sincroniza con Gemini global.
 */
export function saveChefAiSettings(patch) {
  const current = getChefAiSettings();
  const next = { ...current, ...patch };
  try {
    localStorage.setItem(CHEF_SETTINGS_KEY, JSON.stringify(next));
    // Sincronizar con NeuroChat si se configuró Gemini
    if (patch.geminiApiKey) {
      try {
        const rawNc = localStorage.getItem("memorycarl_neurochat_settings");
        const nc = rawNc ? JSON.parse(rawNc) : {};
        nc.apiKey = patch.geminiApiKey;
        if (patch.geminiModel) nc.model = patch.geminiModel;
        nc.enabled = true;
        localStorage.setItem("memorycarl_neurochat_settings", JSON.stringify(nc));
      } catch (_) {}
    }
  } catch (e) {
    console.warn("No se pudo guardar ajustes de Chef AI:", e);
  }
  return next;
}

/**
 * Llama a Google Gemini API para responder.
 */
async function callGemini(messages, apiKey, model = "gemini-2.5-flash") {
  if (!apiKey || apiKey.trim().length < 5) {
    throw new Error("Falta la API Key de Gemini. Pulsa el botón ⚙️ en Chef AI para configurarla.");
  }
  const cleanModel = encodeURIComponent(model || "gemini-2.5-flash");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey.trim()}`;

  // Formatear mensajes a contents de Gemini
  // System instruction va en systemInstruction o en el primer prompt
  const systemMsg = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  const contents = nonSystem.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  if (contents.length === 0 && systemMsg) {
    contents.push({ role: "user", parts: [{ text: "Hola" }] });
  }

  const payload = {
    contents,
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: 2048,
    }
  };

  if (systemMsg) {
    payload.systemInstruction = {
      parts: [{ text: systemMsg.content }]
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      let errMsg = `HTTP ${res.status}`;
      try {
        const errJson = await res.json();
        errMsg = errJson.error?.message || errMsg;
      } catch (_) {}
      throw new Error(`Error Gemini (${res.status}): ${errMsg}`);
    }

    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error("Gemini no devolvió texto en la respuesta.");
    return reply;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === "AbortError") throw new Error("Tiempo de espera agotado con Gemini.");
    throw err;
  }
}

/**
 * Llama al modelo configurado (Gemini u Ollama).
 */
async function callAi(messages) {
  const settings = getChefAiSettings();

  // Si el proveedor preferido es Gemini o hay Gemini key
  if (settings.provider === "gemini" || (settings.geminiApiKey && !settings.ollamaApiKey)) {
    return await callGemini(messages, settings.geminiApiKey, settings.geminiModel);
  }

  // Si usa Ollama
  if (!settings.ollamaApiKey && !isOllamaConfigured()) {
    if (settings.geminiApiKey) {
      return await callGemini(messages, settings.geminiApiKey, settings.geminiModel);
    }
    throw new Error("Chef AI necesita una API Key. Abre ⚙️ Configuración y coloca tu clave de Gemini (recomendado) u Ollama.");
  }

  const baseUrl = (settings.ollamaBaseUrl || "https://ollama.com").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  const body = {
    model: settings.ollamaModel || "gemma4:31b",
    messages,
    stream: false,
    options: { temperature: 0.7, num_predict: 1024 },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.ollamaApiKey}` },
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
    // Si falla por CORS y tenemos Gemini configurado, fallback automático
    if (settings.geminiApiKey && (err.message?.toLowerCase().includes("failed to fetch") || err.name === "TypeError")) {
      console.warn("Ollama falló por CORS, ejecutando fallback transparente a Gemini...");
      return await callGemini(messages, settings.geminiApiKey, settings.geminiModel);
    }
    if (err.name === "AbortError") throw new Error("Tiempo de espera agotado con el modelo. Revisa tu conexión.");
    if (err.message?.toLowerCase().includes("failed to fetch") || err.name === "TypeError") {
      throw new Error("Error de CORS al conectar con Ollama. Te sugerimos abrir ⚙️ Configuración en Chef AI y cambiar a Google Gemini.");
    }
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

  let aiText = await callAi(messages);
  
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
    const raw = await callAi(messages);
    const summaryMatch = raw.match(/RESUMEN:\s*(.+)/);
    const costMatch = raw.match(/COSTO_ESTIMADO:\s*([\d.]+)/);

    const summary = summaryMatch ? summaryMatch[1].trim() : raw.trim().slice(0, 200);
    const estimatedCost = costMatch ? parseFloat(costMatch[1]) : 0;

    return { summary, estimatedCost };
  } catch (e) {
    return { summary: "Resumen no disponible.", estimatedCost: 0 };
  }
}
