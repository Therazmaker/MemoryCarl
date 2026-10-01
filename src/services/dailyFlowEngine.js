/**
 * dailyFlowEngine.js — Motor Central de Rutina Hedónica y Estratégica ("Daily Life Copilot")
 * MemoryCarl
 *
 * Cruza:
 * 1. Flujo de caja real hasta la quincena (15 o último de mes).
 * 2. Estado de comidas caseras preparadas en casa (Meal Bundles & Porciones).
 * 3. Biblioteca hedónica de productos (Afinidad 1-5 ⭐, Tiers: base vs premio, días de abstinencia).
 * 4. Inferencia con Ollama Cloud para generar un briefing matutino humano, proactivo y personalizado.
 */

import { getActiveMealInventory } from "../shopping/mealBundles.js";
import { enrichAllProducts, getDaysSinceLastConsumed } from "../shopping/productIntelligence.js";
import { isOllamaConfigured, getOllamaSettings } from "./ollamaClient.js";
import { getPlannedVsActualForDate } from "../shopping/mealSchedule.js";
import { closeDayIfNeeded, recordDailySnapshot, getWeekdayPattern, getYesterdaySnapshot } from "./financeDayHistory.js";

/**
 * Obtiene la fecha exacta en la zona horaria de Lima, Perú (America/Lima, UTC-5).
 * Evita saltos de fecha accidentales cuando UTC está en el día siguiente.
 * @param {Date|string|number} [input]
 * @returns {Date} Objeto Date configurado en el mediodía local de Lima
 */
export function getLimaDate(input = new Date()) {
  try {
    const base = input instanceof Date ? input : new Date(input);
    if (isNaN(base.getTime())) return new Date();
    const s = base.toLocaleDateString("en-CA", { timeZone: "America/Lima" }); // 'YYYY-MM-DD'
    const [y, m, da] = s.split("-").map(Number);
    return new Date(y, m - 1, da, 12, 0, 0);
  } catch (_) {
    return input instanceof Date ? input : new Date(input);
  }
}

/**
 * Formatea una fecha como 'YYYY-MM-DD' en la zona horaria de Lima, Perú.
 * @param {Date|string|number} [input]
 * @returns {string}
 */
export function getLimaDateString(input = new Date()) {
  try {
    const base = input instanceof Date ? input : new Date(input);
    if (isNaN(base.getTime())) return new Date().toISOString().slice(0, 10);
    return base.toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  } catch (_) {
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Obtiene la hora actual (0-23) en la zona horaria de Lima, Perú.
 * @param {Date|string|number} [input]
 * @returns {number}
 */
export function getLimaHour(input = new Date()) {
  try {
    const base = input instanceof Date ? input : new Date(input);
    if (isNaN(base.getTime())) return new Date().getHours();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Lima",
      hour: "numeric",
      hour12: false
    }).formatToParts(base);
    const hourPart = parts.find(p => p.type === "hour");
    return hourPart ? Number(hourPart.value) : base.getHours();
  } catch (_) {
    return (input instanceof Date ? input : new Date()).getHours();
  }
}

/**
 * Calcula los días restantes para el siguiente cobro de quincena (día 15 o último del mes),
 * fijado a la hora oficial de Lima, Perú.
 * @param {Date} [now]
 * @returns {{ targetDay: number, daysRemaining: number, label: string }}
 */
export function calculateFortnightRunway(now = new Date()) {
  const limaNow = getLimaDate(now);
  const currentDay = limaNow.getDate();
  const currentYear = limaNow.getFullYear();
  const currentMonth = limaNow.getMonth(); // 0-indexed

  // Último día del mes actual en Lima
  const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  let targetDay = 15;
  let daysRemaining = 0;
  let label = "";

  if (currentDay < 15) {
    targetDay = 15;
    daysRemaining = 15 - currentDay;
    label = `Quincena del 15 (en ${daysRemaining} día${daysRemaining === 1 ? "" : "s"})`;
  } else if (currentDay === 15) {
    targetDay = 15;
    daysRemaining = 0;
    label = "¡Hoy es día de cobro (15)!";
  } else if (currentDay < lastDayOfMonth) {
    targetDay = lastDayOfMonth;
    daysRemaining = lastDayOfMonth - currentDay;
    label = `Cierre de mes (día ${lastDayOfMonth}, en ${daysRemaining} día${daysRemaining === 1 ? "" : "s"})`;
  } else {
    targetDay = lastDayOfMonth;
    daysRemaining = 0;
    label = `¡Hoy es último de mes (día ${lastDayOfMonth})! Cobro quincenal.`;
  }

  return { targetDay, daysRemaining: Math.max(1, daysRemaining), rawDaysRemaining: daysRemaining, label };
}

/**
 * Extrae y calcula la liquidez real disponible y margen diario.
 * @param {object} rootState - state global de MemoryCarl
 * @param {Date} [now]
 */
export function computeDailyLiquidity(rootState = {}, now = new Date()) {
  let overrideBalance = null;
  try {
    const raw = localStorage.getItem("memorycarl_liquidity_override");
    if (raw !== null && raw !== "") {
      const parsed = Number(raw);
      if (!isNaN(parsed) && parsed >= 0) overrideBalance = parsed;
    }
  } catch (_) {}

  const rawAccounts = Array.isArray(rootState.financeAccounts) ? rootState.financeAccounts : (Array.isArray(rootState.finance_accounts) ? rootState.finance_accounts : []);
  const btcPrice = Number(rootState.btcPricePen) || 0;

  // Cuentas de terceros o de seguimiento (ej: 'Fergis') que no son saldo líquido propio de Carlos
  const isExcludedAccount = (a) => {
    if (a.archived || a.status === "archived" || a.excludeFromTotal) return true;
    const name = String(a.name || "").toLowerCase().trim();
    if (name.includes("fergis")) return true;
    return false;
  };
  
  // Detalle de cuentas líquidas
  const accountsBreakdown = rawAccounts
    .filter(a => !isExcludedAccount(a))
    .map(a => {
      const isCrypto = a.type === "crypto";
      const penValue = isCrypto ? (Number(a.balance || 0) * btcPrice) : Number(a.balance || 0);
      return {
        id: a.id,
        name: a.name || "Cuenta",
        type: a.type || "fiat",
        rawBalance: Number(a.balance || 0),
        penBalance: Number(penValue.toFixed(2))
      };
    });

  const calculatedBalance = Number(accountsBreakdown.reduce((sum, a) => sum + a.penBalance, 0).toFixed(2));
  const totalBalance = overrideBalance !== null ? overrideBalance : calculatedBalance;

  const commitments = Array.isArray(rootState.financeCommitments) ? rootState.financeCommitments : [];
  const runway = calculateFortnightRunway(now);
  const currentDay = getLimaDate(now).getDate();

  // Compromisos que vencen dentro del ciclo actual (entre hoy y el día de cobro)
  // Ej: Si hoy es 23 y el cobro es el 30, solo compromisos entre el 23 y el 30.
  // Un compromiso del día 1 vence en la SIGUIENTE quincena (mes próximo), NO antes de este 30.
  const upcomingCommitmentsList = commitments
    .filter(c => {
      if (c.resolved || c.active === false || c.status === "paid" || c.status === "cancelled") return false;
      const day = c.dueDay ? Number(c.dueDay) : (c.dueDate ? Number(c.dueDate) : null);
      if (!day) return false;
      return day >= currentDay && day <= runway.targetDay;
    })
    .map(c => ({
      id: c.id,
      name: c.name || "Compromiso",
      amount: Number(c.amount || 0),
      dueDay: c.dueDay || c.dueDate
    }));

  const upcomingCommitments = upcomingCommitmentsList.reduce((sum, c) => sum + c.amount, 0);

  // Permitir al usuario si desea o no deducir compromisos de su margen diario (por defecto solo los del ciclo)
  let deductCommitments = true;
  try {
    const rawSetting = localStorage.getItem("memorycarl_deduct_commitments");
    if (rawSetting === "false") deductCommitments = false;
  } catch (_) {}

  const effectiveCommitments = deductCommitments ? upcomingCommitments : 0;
  const availableLiquidity = Math.max(0, totalBalance - effectiveCommitments);
  const dailyFreeBudget = Number((availableLiquidity / runway.daysRemaining).toFixed(2));

  // Clasificación de holgura
  let liquidityHealth = "moderado";
  if (dailyFreeBudget >= 35) {
    liquidityHealth = "excelente"; // Gran holgura para premios
  } else if (dailyFreeBudget >= 20) {
    liquidityHealth = "bueno";     // Margen cómodo
  } else if (dailyFreeBudget >= 10) {
    liquidityHealth = "ajustado";  // Prudente, preferir casa
  } else {
    liquidityHealth = "critico";   // Blindar gastos
  }

  return {
    totalBalance,
    calculatedBalance,
    isManualOverride: overrideBalance !== null,
    accountsBreakdown,
    upcomingCommitmentsList,
    upcomingCommitments,
    effectiveCommitments,
    deductCommitments,
    availableLiquidity,
    dailyFreeBudget,
    liquidityHealth,
    runway
  };
}

/**
 * Evalúa candidatos a recompensa hedónica según abstinencia y liquidez.
 * @param {object[]} products
 * @param {string} liquidityHealth
 * @param {Date} [now]
 * @param {Array<object>} [todayMovements]
 */
export function evaluateHedonicOpportunity(products = [], liquidityHealth = "bueno", now = new Date(), todayMovements = []) {
  const enriched = enrichAllProducts(products);

  // Buscar productos premium o de alto gusto (rating >= 4)
  const premiumCandidates = enriched.filter(p => (p.tier === "premio_premium" || (p.rating || 0) >= 4) && p.context === "oficina");
  const baseCandidates = enriched.filter(p => p.tier === "base_diario" && p.context === "oficina");

  // Ordenar por días sin consumo (de mayor abstinencia a menor)
  premiumCandidates.sort((a, b) => {
    const daysA = getDaysSinceLastConsumed(a, now) ?? 999;
    const daysB = getDaysSinceLastConsumed(b, now) ?? 999;
    return daysB - daysA;
  });

  const topPremium = premiumCandidates[0] || null;
  const topBase = baseCandidates[0] || null;

  const daysSince = topPremium ? (getDaysSinceLastConsumed(topPremium, now) ?? "bastante") : null;
  const canAffordReward = (liquidityHealth === "excelente" || liquidityHealth === "bueno");

  // Revisar si ya se registró un gasto de premio/gusto hoy
  const alreadySpentRewardToday = Array.isArray(todayMovements) && todayMovements.some(m => {
    const text = `${m.category || ""} ${m.note || ""}`.toLowerCase();
    const premName = topPremium?.name?.toLowerCase() || "monster";
    return /ocio|gusto|premio|recompensa/.test(text) || (premName.length > 2 && text.includes(premName));
  });

  if (alreadySpentRewardToday) {
    return {
      topPremium,
      topBase,
      daysSincePremium: daysSince,
      shouldUpgradeToReward: false,
      alreadySpentToday: true,
      reason: `Ya se registró un gasto de gusto/premio hoy en los movimientos.`
    };
  }

  return {
    topPremium,
    topBase,
    daysSincePremium: daysSince,
    shouldUpgradeToReward: canAffordReward && topPremium && (typeof daysSince === "number" ? daysSince >= 3 : true),
    alreadySpentToday: false,
    reason: canAffordReward 
      ? `Hay buena liquidez (${liquidityHealth}) y llevas ${daysSince} días sin ${topPremium?.name || "darte un gusto"}.`
      : `Liquidez ${liquidityHealth}: conviene mantener la opción base (${topBase?.name || "Volt/Café"}).`
  };
}

/**
 * Obtiene la lista de movimientos tipo gasto registrados hoy.
 * @param {object} rootState
 * @param {Date} [now]
 * @returns {Array<{category: string, amount: number, note: string, sourceLabel: string|null}>}
 */
export function getTodayMovements(rootState = {}, now = new Date()) {
  const dateStr = getLimaDateString(now);
  const all = Array.isArray(rootState.financeMovementsV2)
    ? rootState.financeMovementsV2
    : ((typeof window !== "undefined" && window.FINANCE?.state?.movements) || []);
  return all
    .filter(m => getLimaDateString(m.date) === dateStr && m.type === "expense")
    .map(m => ({
      category: m.category,
      amount: Number(m.amount) || 0,
      note: m.note,
      sourceLabel: m.sourceLabel || null
    }));
}

/**
 * Genera el paquete completo de contexto del día para Ollama o la UI.
 */
/**
 * Infiere si hoy es un día laboral o no según el patrón histórico de gasto en movilidad/transporte.
 * @param {object} ctx - Objeto de contexto del día
 * @param {Date} [now]
 * @returns {{ status: "sin_datos_suficientes" | "parece_dia_libre" | "dia_laboral" | "patron_dia_no_laboral" | "ambiguo", confidence: number }}
 */
export function inferWorkdayStatus(ctx, now = new Date()) {
  const weekday = getLimaDate(now).getDay();
  const pattern = getWeekdayPattern(weekday, getLimaDateString(now), 8);

  if (!pattern || pattern.length < 4) {
    return { status: "sin_datos_suficientes", confidence: 0 };
  }

  const workdayRate = pattern.filter(p => p.hadMobilityExpense).length / pattern.length;

  if (workdayRate < 0.25 || workdayRate > 0.75) {
    const movements = Array.isArray(ctx?.todayMovements) ? ctx.todayMovements : [];
    const hoyTieneMovilidad = movements.some(m => {
      const text = `${m.category || ""} ${m.note || ""}`.toLowerCase();
      return /movilidad|transporte|uber|taxi|bus|gasolina|combustible/.test(text);
    });
    const esperabaMovilidad = workdayRate > 0.5;

    const horaActual = getLimaHour(now);
    if (esperabaMovilidad && !hoyTieneMovilidad && horaActual >= 11) {
      return { status: "parece_dia_libre", confidence: workdayRate };
    }
    if (esperabaMovilidad && hoyTieneMovilidad) {
      return { status: "dia_laboral", confidence: workdayRate };
    }
    if (!esperabaMovilidad) {
      return { status: "patron_dia_no_laboral", confidence: 1 - workdayRate };
    }
  }

  return { status: "ambiguo", confidence: workdayRate };
}

/**
 * Genera el paquete completo de contexto del día para Ollama o la UI.
 */
export function buildDailyFlowContext(rootState = {}, now = new Date()) {
  const products = Array.isArray(rootState.products) ? rootState.products : [];
  const liquidity = computeDailyLiquidity(rootState, now);
  const mealInv = getActiveMealInventory();
  const limaIso = getLimaDateString(now);
  const plannedToday = getPlannedVsActualForDate(limaIso, products);
  const todayMovements = getTodayMovements(rootState, now);
  const totalSpentToday = todayMovements.reduce((s, m) => s + m.amount, 0);
  const hedonic = evaluateHedonicOpportunity(products, liquidity.liquidityHealth, now, todayMovements);

  closeDayIfNeeded(now);

  const hasHomeLunchReady = (mealInv.byMealType.almuerzo?.portions || 0) > 0;
  const ateOutAnyway = hasHomeLunchReady && todayMovements.some(m => {
    const text = `${m.category || ""} ${m.note || ""}`.toLowerCase();
    return /almuerzo|comida|menu|menú|restaurante/.test(text);
  });

  const baseCtx = {
    date: limaIso,
    liquidity,
    mealInventory: mealInv,
    hedonicOpportunity: hedonic,
    plannedToday,
    hasHomeLunchReady,
    hasHomeBreakfastReady: (mealInv.byMealType.desayuno?.portions || 0) > 0,
    ateOutAnyway,
    todayMovements,
    totalSpentToday,
  };

  const workdayStatus = inferWorkdayStatus(baseCtx, now);
  const ctx = {
    ...baseCtx,
    workdayStatus
  };

  recordDailySnapshot(ctx, now);

  return ctx;
}

/**
 * Valida si un texto contiene palabras prohibidas de tono de control.
 * @param {string} text
 * @returns {boolean}
 */
export function hasProhibitedTone(text = "") {
  if (!text) return false;
  return /\b(deberías|deberias|cuidado|evita|no deberías|no deberias)\b/i.test(text);
}

/**
 * Genera el briefing determinista fallback siguiendo la regla hecho + efecto en el presente.
 * @param {object} ctx
 * @param {Date} [now]
 * @returns {string}
 */
export function generateDeterministicFallback(ctx, now = new Date()) {
  const yesterday = getYesterdaySnapshot(now);
  let yesterdayTxt = "";
  if (yesterday) {
    if (yesterday.difference < 0) {
      yesterdayTxt = `Ayer gastaste S/ ${Math.abs(yesterday.difference).toFixed(2)} más de lo previsto.`;
    } else {
      yesterdayTxt = `Ayer te mantuviste dentro de lo previsto.`;
    }
  }

  const isFreeDay = ctx.workdayStatus?.status === "parece_dia_libre" || ctx.workdayStatus?.status === "patron_dia_no_laboral";

  const movements = Array.isArray(ctx.todayMovements) ? ctx.todayMovements : [];
  let todayMovTxt = "";
  if (movements.length > 0) {
    const listStr = movements.map(m => {
      const label = m.category || m.note || "Gasto";
      return `${label} S/ ${m.amount.toFixed(2)}`;
    }).join(", ");
    todayMovTxt = `Ya llevas registrado: ${listStr}.`;
  }

  const marginTxt = `Hoy tu margen libre es S/ ${ctx.liquidity.dailyFreeBudget.toFixed(2)} (${ctx.liquidity.runway.label}).`;

  if (isFreeDay) {
    const parts = ["¡Buenos días Carlos!", yesterdayTxt, marginTxt, todayMovTxt].filter(Boolean);
    return parts.join(" ");
  }

  const lunchTxt = ctx.hasHomeLunchReady
    ? `Tienes almuerzo casero listo en casa (ahorras ~S/ 10.00).`
    : `No hay almuerzo casero listo hoy.`;

  const drinkTxt = ctx.hedonicOpportunity?.shouldUpgradeToReward && ctx.hedonicOpportunity?.topPremium
    ? `Margen disponible para ${ctx.hedonicOpportunity.topPremium.name} hoy.`
    : `Opción base para hoy: ${ctx.hedonicOpportunity?.topBase?.name || "Volt"}.`;

  const parts = ["¡Buenos días Carlos!", yesterdayTxt, marginTxt, todayMovTxt, lunchTxt, drinkTxt].filter(Boolean);
  return parts.join(" ");
}

/**
 * Construye el prompt para que Ollama o Gemini redacte el Daily Briefing matutino.
 */
function buildDailyBriefingPrompt(ctx, now = new Date()) {
  const { runway, dailyFreeBudget, liquidityHealth } = ctx.liquidity;
  const { hedonicOpportunity, mealInventory, hasHomeLunchReady, workdayStatus } = ctx;

  const yesterday = getYesterdaySnapshot(now);
  let yesterdayInfo = "Ayer: Sin registro previo.";
  if (yesterday) {
    if (yesterday.difference < 0) {
      yesterdayInfo = `Ayer: Se gastó S/ ${Math.abs(yesterday.difference).toFixed(2)} MÁS de lo previsto (planeado S/ ${yesterday.dailyFreeBudgetPlanned.toFixed(2)}, real gastado S/ ${yesterday.totalSpentReal.toFixed(2)}).`;
    } else {
      yesterdayInfo = `Ayer: Se gastó S/ ${yesterday.totalSpentReal.toFixed(2)} de S/ ${yesterday.dailyFreeBudgetPlanned.toFixed(2)} previstos (dentro de lo planificado).`;
    }
  }

  const movements = Array.isArray(ctx.todayMovements) ? ctx.todayMovements : [];
  let todayMovInfo = "Gastos de hoy hasta el momento: Ninguno.";
  if (movements.length > 0) {
    const list = movements.map(m => `${m.category || m.note || 'Gasto'}: S/ ${m.amount.toFixed(2)}`).join(", ");
    todayMovInfo = `Gastos de hoy hasta el momento: ${list} (Total: S/ ${ctx.totalSpentToday.toFixed(2)}).`;
  }

  const isFreeDay = workdayStatus?.status === "parece_dia_libre" || workdayStatus?.status === "patron_dia_no_laboral";

  const workdayInfo = isFreeDay
    ? `Día detectado: PARECE DÍA LIBRE / NO LABORAL. OMITIR sugerencias de almuerzo de oficina y bebidas de rutina laboral.`
    : `Día detectado: DÍA LABORAL.`;

  const lunchInfo = isFreeDay ? "" : (hasHomeLunchReady
    ? `En casa hay ${mealInventory.byMealType.almuerzo?.portions || 1} porción/es lista/s de comida casera (${mealInventory.byMealType.almuerzo?.items?.map(i => i.name).join(", ") || ""}).`
    : `En casa NO hay almuerzo preparado.`);

  const drinkSuggestion = isFreeDay ? "" : (hedonicOpportunity.shouldUpgradeToReward && hedonicOpportunity.topPremium
    ? `Luz verde para ${hedonicOpportunity.topPremium.name} (S/ ${hedonicOpportunity.topPremium.price.toFixed(2)}).`
    : `Bebida base habitual: ${hedonicOpportunity.topBase ? hedonicOpportunity.topBase.name : "Volt"} (S/ ${hedonicOpportunity.topBase ? hedonicOpportunity.topBase.price.toFixed(2) : "2.50"}).`);

  return `Eres el Asistente Personal y Estratega de Vida de Carlos en Perú.
Moneda: SOLES PERUANOS (S/).

--- DATOS REALES Y COMPARATIVOS ---
- Fecha: ${ctx.date}
- Registro de Ayer: ${yesterdayInfo}
- Cobro: ${runway.label} (faltan ${runway.daysRemaining} días para la quincena).
- Margen diario libre en cuenta HOY: S/ ${dailyFreeBudget.toFixed(2)} por día.
- ${todayMovInfo}
- Estado del día: ${workdayInfo}
${lunchInfo ? `- Almuerzo: ${lunchInfo}` : ""}
${drinkSuggestion ? `- Bebida oficina: ${drinkSuggestion}` : ""}
----------------------------

REGLAS ESTRICTAS DE TONO (MANDATORIO):
1. NUNCA instruir ni advertir en tono de control: PROHIBIDO usar las palabras 'deberías', 'deberias', 'cuidado', 'evita', 'no deberías', 'no deberias haber'.
2. FORMATO OBLIGATORIO: [hecho pasado] -> [efecto en el presente], [dato neutral]. Ejemplo: "Ayer gastaste S/12 más de lo previsto en comida. Hoy tu margen bajó a S/14.50."
3. Si el día es no laboral o parece día libre, mantén solo el margen y saldo del día, omitiendo sugerencias de oficina/almuerzo.
4. Escribe un 'Morning Briefing' breve, directo y humano (máximo 3 a 4 líneas).`;
}

/**
 * Solicita a Ollama Cloud o Gemini el briefing matutino diario.
 * @param {object} rootState
 * @param {Date} [now]
 * @returns {Promise<{ briefingText: string, context: object }>}
 */
export async function generateDailyBriefing(rootState = {}, now = new Date()) {
  const ctx = buildDailyFlowContext(rootState, now);

  if (!isOllamaConfigured()) {
    const fallback = generateDeterministicFallback(ctx, now);
    return { briefingText: fallback, context: ctx };
  }

  const prompt = buildDailyBriefingPrompt(ctx, now);

  // Intentar primero con Gemini si está configurado (inmune a CORS y ultrarrápido)
  let geminiKey = "";
  let geminiModel = "gemini-2.5-flash";
  try {
    const chefS = JSON.parse(localStorage.getItem("memorycarl_chef_settings") || "{}");
    if (chefS.geminiApiKey) {
      geminiKey = chefS.geminiApiKey;
      if (chefS.geminiModel) geminiModel = chefS.geminiModel;
    }
    if (!geminiKey) {
      const nc = JSON.parse(localStorage.getItem("memorycarl_neurochat_settings") || "{}");
      if (nc.apiKey) {
        geminiKey = nc.apiKey;
        if (nc.model && nc.model.includes("gemini")) geminiModel = nc.model;
      }
    }
  } catch (_) {}

  if (geminiKey && geminiKey.length > 5) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(geminiModel)}:generateContent?key=${geminiKey.trim()}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: "Eres un estratega de vida y asistente diario directo y cercano. Responde en español peruano natural sin todo de orden ni regaño." }] },
          generationConfig: { temperature: 0.6, maxOutputTokens: 500 }
        })
      });
      if (res.ok) {
        const data = await res.json();
        const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (rawText.trim()) {
          if (hasProhibitedTone(rawText)) {
            console.warn("AI Gemini returned prohibited tone words; substituting with deterministic fallback.");
            return { briefingText: generateDeterministicFallback(ctx, now), context: ctx };
          }
          return { briefingText: rawText.trim(), context: ctx };
        }
      }
    } catch (gErr) {
      console.warn("Gemini falló en briefing, probando Ollama...", gErr);
    }
  }

  const settings = getOllamaSettings();
  const baseUrl = (settings.baseUrl || "https://ollama.com").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  const messages = [
    { role: "system", content: "Eres un estratega de vida y asistente diario directo y cercano. Responde en español peruano natural sin todo de orden ni regaño." },
    { role: "user", content: prompt }
  ];

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
      body: JSON.stringify({
        model: settings.model || "gemma4:31b",
        messages,
        stream: false,
        options: { temperature: 0.7, num_predict: 500 }
      })
    });
    if (!res || !res.ok) throw new Error(`Ollama HTTP ${res?.status}`);
    const data = await res.json();
    const rawText = data?.message?.content || "";
    if (hasProhibitedTone(rawText)) {
      console.warn("AI Ollama returned prohibited tone words; substituting with deterministic fallback.");
      return { briefingText: generateDeterministicFallback(ctx, now), context: ctx };
    }
    return { briefingText: rawText, context: ctx };
  } catch (err) {
    console.warn("Fallo al llamar a LLM para el briefing, usando fallback local:", err);
    const fallback = generateDeterministicFallback(ctx, now);
    return { briefingText: fallback, context: ctx };
  }
}
