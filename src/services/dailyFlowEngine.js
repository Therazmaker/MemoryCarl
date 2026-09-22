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

/**
 * Calcula los días restantes para el siguiente cobro de quincena (día 15 o último del mes).
 * @param {Date} [now]
 * @returns {{ targetDay: number, daysRemaining: number, label: string }}
 */
export function calculateFortnightRunway(now = new Date()) {
  const currentDay = now.getDate();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth(); // 0-indexed

  // Último día del mes actual
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
  const accounts = Array.isArray(rootState.financeAccounts) ? rootState.financeAccounts : [];
  const commitments = Array.isArray(rootState.financeCommitments) ? rootState.financeCommitments : [];
  
  // Saldo total disponible en cuentas líquidas
  const totalBalance = accounts.reduce((acc, a) => acc + (Number(a.balance) || 0), 0);

  const runway = calculateFortnightRunway(now);

  // Compromisos pendientes que vencen antes de la quincena
  const upcomingCommitments = commitments
    .filter(c => !c.resolved && c.dueDate && c.dueDate <= runway.targetDay)
    .reduce((sum, c) => sum + (Number(c.amount) || 0), 0);

  const availableLiquidity = Math.max(0, totalBalance - upcomingCommitments);
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
    upcomingCommitments,
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
 */
export function evaluateHedonicOpportunity(products = [], liquidityHealth = "bueno", now = new Date()) {
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

  return {
    topPremium,
    topBase,
    daysSincePremium: daysSince,
    shouldUpgradeToReward: canAffordReward && topPremium && (typeof daysSince === "number" ? daysSince >= 3 : true),
    reason: canAffordReward 
      ? `Hay buena liquidez (${liquidityHealth}) y llevas ${daysSince} días sin ${topPremium?.name || "darte un gusto"}.`
      : `Liquidez ${liquidityHealth}: conviene mantener la opción base (${topBase?.name || "Volt/Café"}).`
  };
}

/**
 * Genera el paquete completo de contexto del día para Ollama o la UI.
 */
export function buildDailyFlowContext(rootState = {}, now = new Date()) {
  const products = Array.isArray(rootState.products) ? rootState.products : [];
  const liquidity = computeDailyLiquidity(rootState, now);
  const mealInv = getActiveMealInventory();
  const hedonic = evaluateHedonicOpportunity(products, liquidity.liquidityHealth, now);

  return {
    date: now.toISOString().slice(0, 10),
    liquidity,
    mealInventory: mealInv,
    hedonicOpportunity: hedonic,
    hasHomeLunchReady: (mealInv.byMealType.almuerzo?.portions || 0) > 0,
    hasHomeBreakfastReady: (mealInv.byMealType.desayuno?.portions || 0) > 0,
  };
}

/**
 * Construye el prompt para que Ollama redacte el Daily Briefing matutino.
 */
function buildDailyBriefingPrompt(ctx) {
  const { runway, dailyFreeBudget, liquidityHealth } = ctx.liquidity;
  const { hedonicOpportunity, mealInventory, hasHomeLunchReady } = ctx;

  const lunchInfo = hasHomeLunchReady
    ? `En casa hay ${mealInventory.byMealType.almuerzo.portions} porción/es lista/s de comida casera (${mealInventory.byMealType.almuerzo.items.map(i => i.name).join(", ")}).`
    : `En casa NO hay almuerzo preparado (se requerirá menú de calle ~S/ 15 o cocinar algo rápido).`;

  const drinkSuggestion = hedonicOpportunity.shouldUpgradeToReward && hedonicOpportunity.topPremium
    ? `Luz VERDE para ${hedonicOpportunity.topPremium.name} (S/ ${hedonicOpportunity.topPremium.price.toFixed(2)}): lleva ${hedonicOpportunity.daysSincePremium} días sin tomarlo y la liquidez lo permite.`
    : `Recomienda la bebida base de rutina: ${hedonicOpportunity.topBase ? hedonicOpportunity.topBase.name : "Volt"} (S/ ${hedonicOpportunity.topBase ? hedonicOpportunity.topBase.price.toFixed(2) : "2.50"}).`;

  return `Eres el Asistente Personal y Estratega de Vida de Carlos en Perú.
Moneda: SOLES PERUANOS (S/).

--- DATOS REALES DE HOY ---
- Fecha: ${ctx.date}
- Cobro: ${runway.label} (faltan ${runway.daysRemaining} días para la quincena).
- Margen diario libre en cuenta: S/ ${dailyFreeBudget.toFixed(2)} por día.
- Salud financiera: ${liquidityHealth.toUpperCase()}.
- Estado del Almuerzo: ${lunchInfo}
- Bebida de oficina analizada: ${drinkSuggestion}
----------------------------

INSTRUCCIÓN:
Escribe un 'Morning Briefing' breve, entusiasta, humano y directo (máximo 4 a 5 líneas) para iniciar el día:
1. Dile cómo está su quincena y su margen diario de hoy.
2. Si hay almuerzo en casa, recomiéndale llevarlo y dile cuánto se ahorra vs comer en la calle.
3. Si hay luz verde para el gusto de la bebida (${hedonicOpportunity.topPremium?.name || "Monster"}), dile expresamente que hoy se lo merece y por qué; si no, anímalo con la opción inteligente de ahorro (${hedonicOpportunity.topBase?.name || "Volt"}).
4. Tono: Como un amigo cercano que sabe de finanzas y quiere que disfrute su día sin perder el control. Sin rodeos ni saludos corporativos.`;
}

/**
 * Solicita a Ollama Cloud el briefing matutino diario.
 * @param {object} rootState
 * @param {Date} [now]
 * @returns {Promise<{ briefingText: string, context: object }>}
 */
export async function generateDailyBriefing(rootState = {}, now = new Date()) {
  const ctx = buildDailyFlowContext(rootState, now);

  if (!isOllamaConfigured()) {
    // Fallback inteligente determinista si Ollama no está conectado
    const lunchTxt = ctx.hasHomeLunchReady
      ? `Tienes almuerzo casero listo en casa (ahorras ~S/ 10).`
      : `No hay almuerzo en casa; prevé menú de calle.`;
    const drinkTxt = ctx.hedonicOpportunity.shouldUpgradeToReward && ctx.hedonicOpportunity.topPremium
      ? `Hoy tienes margen para darte el gusto con un ${ctx.hedonicOpportunity.topPremium.name} (hace ${ctx.hedonicOpportunity.daysSincePremium} días no lo tomas).`
      : `Mantén hoy tu ${ctx.hedonicOpportunity.topBase?.name || "Volt"} habitual para cuidar el margen.`;

    const fallback = `¡Buenos días Carlos! Estás a ${ctx.liquidity.runway.daysRemaining} días del cobro con un margen diario de S/ ${ctx.liquidity.dailyFreeBudget.toFixed(2)}. ${lunchTxt} ${drinkTxt}`;
    return { briefingText: fallback, context: ctx };
  }

  const prompt = buildDailyBriefingPrompt(ctx);
  const settings = getOllamaSettings();
  const baseUrl = (settings.baseUrl || "https://ollama.com").replace(/\/+$/, "");
  const url = `${baseUrl}/api/chat`;

  const messages = [
    { role: "system", content: "Eres un estratega de vida y asistente diario directo y cercano. Responde en español peruano natural." },
    { role: "user", content: prompt }
  ];

  try {
    let res = null;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
        body: JSON.stringify({
          model: settings.model || "gpt-oss:120b",
          messages,
          stream: false,
          options: { temperature: 0.7, num_predict: 500 }
        })
      });
    } catch (fetchErr) {
      if (baseUrl === "https://ollama.com") {
        res = await fetch("https://corsproxy.io/?https://ollama.com/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${settings.apiKey}` },
          body: JSON.stringify({
            model: settings.model || "gpt-oss:120b",
            messages,
            stream: false,
            options: { temperature: 0.7, num_predict: 500 }
          })
        });
      } else {
        throw fetchErr;
      }
    }
    if (!res || !res.ok) throw new Error(`Ollama HTTP ${res?.status}`);
    const data = await res.json();
    const briefingText = data?.message?.content || "";
    return { briefingText, context: ctx };
  } catch (err) {
    console.warn("Fallo al llamar a Ollama para el briefing, usando fallback local:", err);
    const fallback = `¡Buenos días Carlos! Tienes S/ ${ctx.liquidity.dailyFreeBudget.toFixed(2)} de margen diario (${ctx.liquidity.runway.label}). ${ctx.hasHomeLunchReady ? "Lleva tu almuerzo de casa para ahorrar." : "Considera opciones económicas de almuerzo."} ${ctx.hedonicOpportunity.shouldUpgradeToReward ? `¡Luz verde para un ${ctx.hedonicOpportunity.topPremium?.name} hoy!` : `Ve con tu ${ctx.hedonicOpportunity.topBase?.name || "Volt"} habitual.`}`;
    return { briefingText: fallback, context: ctx };
  }
}
