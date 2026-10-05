/**
 * shoppingAi.js — Asistente Chef AI para la sección de Compras
 * Usa el mismo cliente Ollama Cloud que NeuroChat.
 * Moneda: Soles peruanos (S/)
 */

import { getOllamaSettings, isOllamaConfigured } from "../services/ollamaClient.js";
import { formatProductForAiPrompt, enrichAllProducts } from "./productIntelligence.js";
import { formatMealInventoryForAiPrompt } from "./mealBundles.js";
import { DAYS_OF_WEEK, MEAL_SLOTS } from "./mealSchedule.js";

const DEFAULT_TIMEOUT_MS = 30_000;

/** Format date as "Vie 11 Jul" */
export function formatDayLabel(isoDate) {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T12:00:00");
  const days = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];
  const months = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`;
}

/** Returns today's ISO date string (YYYY-MM-DD) in Lima, Peru timezone */
export function todayISO() {
  try {
    return new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  } catch (_) {
    return new Date().toISOString().split("T")[0];
  }
}

/**
 * Build system prompt with product library, inventory + past days context.
 */
function buildChefSystemPrompt(products, chatHistory, pastDays = [], inventory = [], financeContext = null, extraOptions = {}) {
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

  let finAccountsStr = "";
  if (Array.isArray(extraOptions.financeAccounts) && extraOptions.financeAccounts.length > 0) {
    finAccountsStr = `\nCuentas disponibles para transacciones: ${extraOptions.financeAccounts.join(", ")}\n`;
  }

  let financeStr = "";
  if (financeContext) {
    financeStr = `
--- SITUACIÓN FINANCIERA ACTUAL ---
- Saldo total disponible: S/ ${financeContext.totalBalance.toFixed(2)}
- Ciclo de cobro: ${financeContext.runway?.label || "15 y fin de mes"} (quedan ${financeContext.runway?.daysRemaining || 0} días)
- Margen libre diario: S/ ${financeContext.dailyFreeBudget.toFixed(2)} / día
- Salud de liquidez: ${financeContext.liquidityHealth?.toUpperCase() || "MODERADO"}${finAccountsStr}
--------------------------------------------------------------------------`;
  }

  // Schedule context
  let scheduleStr = "";
  if (extraOptions.weeklySchedule) {
    const weekly = extraOptions.weeklySchedule;
    let weeklyDetail = "";
    DAYS_OF_WEEK.forEach(day => {
      const daySched = weekly[day.key] || {};
      const daySlotsStr = MEAL_SLOTS.map(slot => {
        const rawItems = daySched[slot.id];
        const items = Array.isArray(rawItems) ? rawItems : (Array.isArray(rawItems?.items) ? rawItems.items : []);
        if (items.length === 0) return null;
        const itemsList = items.map(it => {
          const price = Number(it.estimatedPrice ?? it.price ?? it.unitPrice ?? 0);
          return `${it.name}${it.qty > 1 ? ` x${it.qty}` : ""} (S/ ${price.toFixed(2)})`;
        }).join(", ");
        return `${slot.icon} ${slot.label}: ${itemsList}`;
      }).filter(Boolean).join(" | ");
      weeklyDetail += `  - ${day.label} (${day.key}): ${daySlotsStr || "(Sin menú proyectado)"}\n`;
    });

    let todayDetail = "";
    if (extraOptions.scheduleContext) {
      const sc = extraOptions.scheduleContext;
      if (sc.actualItems && sc.actualItems.length > 0) {
        todayDetail = "  - Consumos reales registrados hoy:\n" +
          sc.actualItems.map(a => `    • [${a.slotId || "comida"}] ${a.name}: S/ ${(Number(a.price)||0).toFixed(2)}`).join("\n") + "\n";
      } else {
        todayDetail = "  - Consumos reales registrados hoy: Ninguno aún\n";
      }
    }

    scheduleStr = `
--- HORARIO SEMANAL PROYECTADO (Schedule Template) ---
${weeklyDetail}${todayDetail}--------------------------------------------------------------`;
  } else if (extraOptions.scheduleContext) {
    const sc = extraOptions.scheduleContext;
    let slotsDetail = "";
    if (sc.bySlot) {
      Object.values(sc.bySlot).forEach(slot => {
        const rawItems = slot.items || [];
        const itemNames = rawItems.map(it => {
          const price = Number(it.estimatedPrice ?? it.price ?? it.totalPrice ?? it.unitPrice ?? 0);
          return `${it.name}${it.qty > 1 ? ` x${it.qty}` : ""} (S/ ${price.toFixed(2)})`;
        }).join(", ");
        slotsDetail += `  - ${slot.icon} ${slot.label}: ${itemNames || "(Nada proyectado)"}\n`;
      });
    }
    let actualDetail = "";
    if (sc.actualItems && sc.actualItems.length > 0) {
      actualDetail = "  - Consumos reales registrados hoy:\n" +
        sc.actualItems.map(a => `    • [${a.slotId || "comida"}] ${a.name}: S/ ${(Number(a.price)||0).toFixed(2)}`).join("\n") + "\n";
    } else {
      actualDetail = "  - Consumos reales registrados hoy: Ninguno aún\n";
    }

    scheduleStr = `
--- HORARIO Y CONSUMO PROYECTADO DE HOY (${sc.dayKey || "día"}) ---
Costo proyectado del día: S/ ${Number(sc.dayTotalCost || 0).toFixed(2)}
Proyección por tiempos de comida:
${slotsDetail}${actualDetail}--------------------------------------------------------------`;
  }

  // Finance movements context
  let finMovementsStr = "";
  if (Array.isArray(extraOptions.financeMovements) && extraOptions.financeMovements.length > 0) {
    const recentMovs = extraOptions.financeMovements.slice(0, 12);
    const lines = recentMovs.map(m => {
      const sign = m.type === "expense" ? "-" : "+";
      const cat = m.category ? ` [${m.category}]` : "";
      const note = m.note ? ` (${m.note})` : "";
      const acc = m.accountName ? ` · ${m.accountName}` : "";
      const date = m.date ? String(m.date).slice(0, 10) : "";
      return `  - ${date} | ${sign}S/ ${Number(m.amount||0).toFixed(2)}${cat}${note}${acc}`;
    });
    finMovementsStr = `
--- RECIENTES MOVIMIENTOS EN FINANZAS (Últimos ${recentMovs.length}) ---
${lines.join("\n")}
--------------------------------------------------------------`;
  }

  return `Eres "Chef AI", el estratega personal de cocina, hábitos, alimentación y finanzas diarias de Carlos en Perú.
La moneda es siempre SOLES PERUANOS (S/). Nunca uses dólares.
${financeStr}${scheduleStr}${finMovementsStr}

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

1. **Gestión Inteligente de Comidas, Schedule y Finanzas:**
   - Tienes visión completa de la despensa, el Horario Proyectado de Comidas (Schedule) y los Movimientos en Finanzas.
   - Cuando Carlos te mencione lo que almorzó, cenó, tomó o compró (ej. "almorcé un menú de 15 soles y pagué con Yape"), puedes responder cercanamente Y actualizar/crear acciones en el Schedule o en Finanzas.

2. **Cerebro y Aprendizaje Continuo (NIVEL DIOS):**
   - Si menciona un producto nuevo o actualiza precios/preferencias, genera un \`learnProduct\`.
   - Si cocinó para varios días, genera un \`createMealBundle\` con porciones estimadas.
   - Si consumió comida casera guardada, genera un \`consumeMealBundle\`.
   - Si consumió algo de su horario o calle, genera \`logScheduleConsumption\` o \`syncFoodExpense\`.
   - Si te pide cambiar, actualizar, modificar o reemplazar la plantilla del horario proyectado de cualquier día (ej. "cambia mi almuerzo de los lunes por pollo a la brasa 18 soles", "actualiza mi menú de hoy/mañana", "en la cena del viernes pon pizza 12 soles"), SIEMPRE genera la acción \`updateMealSchedule\`.
   - Si quiere registrar un gasto o ingreso financiero directo, genera \`recordFinanceMovement\`.

3. **Matemática Fraccional y Comidas:**
   - Calcula el costo real de su comida fraccionada (ej. si comió parte de lo que tenía en despensa).

4. **Acciones JSON (Al final de tu respuesta):**
   Pon el bloque JSON al final si hay productos, porciones, schedule o movimientos de finanzas que actualizar/crear:
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
     },
     "logScheduleConsumption": {
       "slotId": "almuerzo",
       "name": "Menú Ejecutivo / Almuerzo",
       "price": 14.00,
       "isPlanned": true
     },
     "updateMealSchedule": {
       "dayKey": "lunes",
       "slotId": "almuerzo",
       "items": [
         {
           "name": "Pollo al Horno con Papa",
           "portions": 2,
           "unit": "plato",
           "unitPrice": 18.00,
           "estimatedPrice": 18.00,
           "origin": "Cocinado en casa",
           "notes": "Preparado para 2 días"
         }
       ]
     },

CRÍTICO PARA HORARIO (SCHEDULE): Si el usuario solicita modificar el menú u horario proyectado para cualquier día (lunes a domingo, hoy o mañana), SIEMPRE debes generar la acción \`updateMealSchedule\` en \`---ACTIONS---\`. \`dayKey\` debe ser la clave del día ('lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo', 'hoy', 'manana') y \`slotId\` una de: 'desayuno', 'almuerzo', 'cena', 'bebidas' (o 'snack'). Los ítems pueden incluir campos detallados opcionales: \`portions\` (o \`qty\`), \`unit\` ("porción", "plato", etc), \`unitPrice\` (o \`estimatedPrice\`), \`origin\` ("Comprado fuera", "Cocinado en casa", "En despensa"), y \`notes\`.
     "recordFinanceMovement": {
       "type": "expense",
       "amount": 15.00,
       "category": "Comida/Restaurante",
       "note": "Almuerzo menú ejecutivo",
       "accountName": "Yape"
     },
     "syncFoodExpense": {
       "type": "expense",
       "amount": 15.00,
       "category": "Comida/Restaurante",
       "note": "Almuerzo menú ejecutivo",
       "accountName": "Yape",
       "slotId": "almuerzo",
       "mealName": "Menú Ejecutivo",
       "isPlanned": true
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

  const provider = chefCustom.provider || (geminiKey ? "gemini" : (chefCustom.claudeApiKey ? "claude" : (ollama.apiKey ? "ollama" : "gemini")));

  return {
    provider, // "gemini" | "claude" | "ollama"
    geminiApiKey: geminiKey,
    geminiModel,
    claudeApiKey: chefCustom.claudeApiKey || "",
    claudeModel: chefCustom.claudeModel || "claude-haiku-4-5",
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
 * Interpreta errores de API y genera un diagnóstico humano y comprensible.
 * Explica si se acabaron las llamadas gratis (cuota 429), clave inválida (400/401/403),
 * modelo no encontrado (404), timeout o CORS.
 * @param {Error|object} err
 * @param {string} provider - "Gemini" | "Ollama"
 * @param {number} [status]
 * @param {string} [rawMessage]
 * @returns {string}
 */
export function explainAiError(err, provider = "Gemini", status = 0, rawMessage = "") {
  const msg = (rawMessage || err?.message || String(err) || "").toLowerCase();
  const code = status || (err?.status ? Number(err.status) : 0);

  // 1. Cuota agotada / Límite de llamadas gratis excedido (Rate Limit / Quota)
  if (code === 429 || msg.includes("resource_exhausted") || msg.includes("quota") || msg.includes("rate limit") || msg.includes("too many requests")) {
    return `⚠️ LÍMITE DE LLAMADAS ALCANZADO (${provider}):
Te has quedado sin llamadas en este minuto o por el día de hoy (error 429 / Quota Exceeded).
👉 Solución: Espera 1 o 2 minutos para que se reinicie tu cuota por minuto, o pulsa ⚙️ en Chef AI para cambiar a otro modelo más ligero o revisar tu clave.`;
  }

  // 2. API Key inválida o expirada
  if (code === 401 || code === 403 || msg.includes("api_key_invalid") || msg.includes("invalid api key") || msg.includes("permission_denied") || msg.includes("unauthenticated")) {
    return `🔑 ERROR DE AUTENTICACIÓN (${provider}):
La API Key configurada no es válida o ha sido revocada (error ${code || 401}).
👉 Solución: Pulsa ⚙️ en Chef AI y copia tu API Key correcta (Google AI Studio, Anthropic o Ollama).`;
  }

  // 3. Modelo no encontrado o no disponible
  if (code === 404 || msg.includes("not found") || msg.includes("is not supported") || msg.includes("unsupported model")) {
    return `🤖 MODELO NO ENCONTRADO (${provider}):
El modelo seleccionado no está disponible o cambió de nombre (error 404).
👉 Solución: Pulsa ⚙️ en Chef AI y selecciona un modelo recomendado.`;
  }

  // 4. Bloqueo de CORS o red
  if (msg.includes("failed to fetch") || err?.name === "TypeError" || msg.includes("cors")) {
    return `🌐 ERROR DE RED / CORS (${provider}):
El navegador bloqueó la conexión directa.
👉 Solución: Pulsa ⚙️ en Chef AI para verificar la clave o cambia a un proveedor compatible con navegador.`;
  }

  // 5. Tiempo de espera agotado (Timeout)
  if (err?.name === "AbortError" || msg.includes("timeout") || msg.includes("tiempo de espera")) {
    return `⏱️ TIEMPO DE ESPERA AGOTADO (${provider}):
El servidor tardó más de 30 segundos en responder. Tu conexión a internet o el servidor de la IA están saturados.
👉 Solución: Intenta enviar tu mensaje nuevamente en unos segundos.`;
  }

  // Fallback con el detalle técnico exacto
  return `❌ ERROR DEL COPILOTO (${provider}${code ? ` ${code}` : ""}):
${rawMessage || err?.message || "Ocurrió un error inesperado al procesar la respuesta."}
👉 Pulsa ⚙️ en Chef AI para revisar tu clave o cambiar de proveedor.`;
}

/**
 * Llama a Anthropic Claude API para responder.
 */
export async function callClaude(messages, apiKey, model = "claude-haiku-4-5") {
  if (!apiKey || apiKey.trim().length < 5) {
    throw new Error("Falta la API Key de Anthropic Claude. Pulsa el botón ⚙️ en Chef AI para configurarla.");
  }
  const url = "https://api.anthropic.com/v1/messages";

  const systemMsg = messages.find(m => m.role === "system");
  const nonSystem = messages.filter(m => m.role !== "system");

  const formattedMessages = nonSystem.map(m => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: m.content
  }));

  if (formattedMessages.length === 0 && systemMsg) {
    formattedMessages.push({ role: "user", content: "Hola" });
  }

  const payload = {
    model: model || "claude-haiku-4-5",
    max_tokens: 2048,
    messages: formattedMessages,
  };

  if (systemMsg) {
    payload.system = [
      {
        type: "text",
        text: systemMsg.content,
        cache_control: { type: "ephemeral" }
      }
    ];
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
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
      const explained = explainAiError(null, "Anthropic Claude", res.status, errMsg);
      const customErr = new Error(explained);
      customErr.status = res.status;
      customErr.rawMessage = errMsg;
      throw customErr;
    }

    const data = await res.json();
    if (data?.usage) {
      console.log(`[Claude Prompt Caching] Tokens: input=${data.usage.input_tokens || 0}, output=${data.usage.output_tokens || 0}, cache_creation=${data.usage.cache_creation_input_tokens || 0}, cache_read=${data.usage.cache_read_input_tokens || 0}`);
    }
    const reply = data?.content?.[0]?.text;
    if (!reply) throw new Error("Claude no devolvió texto en la respuesta.");
    return reply;
  } catch (err) {
    clearTimeout(timer);
    if (err.rawMessage) throw err;
    const explained = explainAiError(err, "Anthropic Claude");
    throw new Error(explained);
  }
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
      const explained = explainAiError(null, "Google Gemini", res.status, errMsg);
      const customErr = new Error(explained);
      customErr.status = res.status;
      customErr.rawMessage = errMsg;
      throw customErr;
    }

    const data = await res.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) throw new Error("Gemini no devolvió texto en la respuesta. Puede que tu mensaje haya activado un filtro de seguridad.");
    return reply;
  } catch (err) {
    clearTimeout(timer);
    if (err.rawMessage) throw err; // ya viene formateado
    const explained = explainAiError(err, "Google Gemini");
    throw new Error(explained);
  }
}

/**
 * Llama al modelo configurado (Gemini u Ollama).
 */
async function callAi(messages) {
  const settings = getChefAiSettings();

  // Si el proveedor es Claude
  if (settings.provider === "claude") {
    return await callClaude(messages, settings.claudeApiKey, settings.claudeModel);
  }

  // Si el proveedor preferido es Gemini o hay Gemini key y no hay Claude/Ollama configurados
  if (settings.provider === "gemini" || (settings.geminiApiKey && !settings.ollamaApiKey && !settings.claudeApiKey)) {
    return await callGemini(messages, settings.geminiApiKey, settings.geminiModel);
  }

  // Si usa Ollama
  if (!settings.ollamaApiKey && !isOllamaConfigured()) {
    if (settings.claudeApiKey) {
      return await callClaude(messages, settings.claudeApiKey, settings.claudeModel);
    }
    if (settings.geminiApiKey) {
      return await callGemini(messages, settings.geminiApiKey, settings.geminiModel);
    }
    throw new Error("Chef AI necesita una API Key. Abre ⚙️ Configuración y coloca tu clave de Claude (Anthropic), Gemini (Google AI Studio) u Ollama.");
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
      const explained = explainAiError(null, "Ollama Cloud", res.status, errMsg);
      const customErr = new Error(explained);
      customErr.status = res.status;
      customErr.rawMessage = errMsg;
      throw customErr;
    }
    const data = await res.json();
    return data?.message?.content || "";
  } catch (err) {
    clearTimeout(timer);
    if (err.rawMessage) throw err;
    // Si falla por CORS y tenemos Gemini configurado, fallback automático
    if (settings.geminiApiKey && (err.message?.toLowerCase().includes("failed to fetch") || err.name === "TypeError")) {
      console.warn("Ollama falló por CORS, ejecutando fallback transparente a Gemini...");
      return await callGemini(messages, settings.geminiApiKey, settings.geminiModel);
    }
    const explained = explainAiError(err, "Ollama Cloud");
    throw new Error(explained);
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
export async function sendShoppingAiMessage(text, chatHistory, products, pastDays = [], inventory = [], financeContext = null, extraOptions = {}) {
  if (!text || !text.trim()) return chatHistory;

  const systemPrompt = buildChefSystemPrompt(products, chatHistory, pastDays, inventory, financeContext, extraOptions);
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
