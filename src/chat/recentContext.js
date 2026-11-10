/**
 * recentContext.js — Capa de Días Recientes (Capa 3 de NeuroChat)
 * MemoryCarl / NeuroChat
 *
 * Genera el resumen de los últimos 2-3 días a partir de dayStore.js (tope ~800 caracteres)
 * para mantener la continuidad situacional cercana ("de qué venías hablando").
 */

import { getAllDays } from "../day/dayStore.js";
import { buildJournalPromptBlock } from "../day/journal.js";
import { buildFinanceHabitsPromptBlock } from "../finance/finance_habits.js";
import { buildQuincenaPlanCard } from "../finance/finance_quincena_plan.js";
import { buildLifeFactsPromptBlock } from "./lifeFacts.js";
import { buildOpenThreadsPromptBlock } from "./openThreads.js";

const MAX_RECENT_DAYS_CHARS = 800;

/**
 * Formatea el bloque de texto [ÚLTIMOS DÍAS] a partir de dayStore.js.
 *
 * @param {object} options - { limitDays?: number, maxChars?: number }
 * @returns {{ blockText: string, charCount: number, dayCount: number }}
 */
export function buildRecentDaysPromptBlock(options = {}) {
  const limitDays = options.limitDays || 3;
  const maxChars = options.maxChars || MAX_RECENT_DAYS_CHARS;

  const days = getAllDays();
  if (!Array.isArray(days) || days.length === 0) {
    return { blockText: "", charCount: 0, dayCount: 0 };
  }

  // Ordenar días por fecha descendente
  const sortedDays = [...days]
    .filter((d) => d && d.date && (d.summary || d.dominantEmotion || (d.dominantThemes && d.dominantThemes.length > 0)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limitDays);

  if (sortedDays.length === 0) {
    return { blockText: "", charCount: 0, dayCount: 0 };
  }

  const lines = [];
  let currentChars = 0;

  for (const day of sortedDays) {
    const emotionStr = day.dominantEmotion ? ` [emoción: ${day.dominantEmotion}]` : "";
    const themesStr = Array.isArray(day.dominantThemes) && day.dominantThemes.length > 0
      ? ` (temas: ${day.dominantThemes.join(", ")})`
      : "";
    const summaryText = day.summary ? day.summary.trim() : "Día sin resumen detallado.";

    const line = `- ${day.date}${emotionStr}${themesStr}: ${summaryText}`;

    if (currentChars + line.length > maxChars) {
      // Recortar la última línea si se excede el presupuesto
      const remainingSpace = maxChars - currentChars - 10;
      if (remainingSpace > 30) {
        lines.push(line.slice(0, remainingSpace) + "...");
      }
      break;
    }

    lines.push(line);
    currentChars += line.length + 1;
  }

  if (lines.length === 0) {
    return { blockText: "", charCount: 0, dayCount: 0 };
  }

  const blockText = `\n\n## ÚLTIMOS DÍAS (CONTEXTO DE DÍAS RECIENTES)\nResumen de lo vivido en los últimos días. Sirve para saber de qué venía hablando el usuario recientemente.\n${lines.join("\n")}`;

  return {
    blockText,
    charCount: blockText.length,
    dayCount: lines.length,
  };
}

/**
 * Retorna las métricas unificadas de consumo en caracteres de las 4 capas de continuidad en el prompt.
 *
 * @param {string} userInput
 * @param {Array} activatedNeurons
 * @param {Array} memories
 * @returns {object}
 */
export function getContinuityPromptStats(userInput = "", activatedNeurons = [], memories = []) {
  const l1 = buildLifeFactsPromptBlock(userInput);
  const l2 = buildOpenThreadsPromptBlock();
  const l3 = buildRecentDaysPromptBlock();

  let l4Text = "";
  if (Array.isArray(activatedNeurons) && activatedNeurons.length > 0) {
    l4Text += activatedNeurons.map((c) => {
      const n = c.neuron || c;
      return `- [${n.core?.domain || "general"}] ${n.core?.concept || ""}: ${n.core?.summary || ""}`;
    }).join("\n");
  }
  if (Array.isArray(memories) && memories.length > 0) {
    l4Text += memories.map((m) => `- ${m.title || "Memoria"}: ${m.snippet || ""}`).join("\n");
  }

  const layers = {
    capa1_hechosVigentes: { chars: l1.charCount, count: l1.factCount },
    capa2_hilosAbiertos: { chars: l2.charCount, count: l2.threadCount },
    capa3_diasRecientes: { chars: l3.charCount, count: l3.dayCount },
    capa4_neuronasYMemorias: { chars: l4Text.length, count: (activatedNeurons?.length || 0) + (memories?.length || 0) },
  };

  const totalChars = l1.charCount + l2.charCount + l3.charCount + l4Text.length;

  return {
    layers,
    totalChars,
  };
}

if (typeof window !== "undefined") {
  window.__getContinuityPromptStats = (userInput = "") => getContinuityPromptStats(userInput);
}

/** Diario de los últimos días (pestaña 📓 Diario), compacto. Vacío si no hay entradas. */
export function buildRecentJournalBlock() {
  try {
    return buildJournalPromptBlock(getAllDays());
  } catch (_e) {
    return "";
  }
}

const MONEY_RE = /\b(plata|dinero|lucas|soles|gast\w*|compr\w*|pag\w*|deud\w*|debo|debe\w*|prest\w*|sueldo|quincena|ahorr\w*|presupuesto|finanz\w*|banco|cuenta|tarjeta|caro|barato|precio|cuesta|cobr\w*|pozo|alquiler|suscrip\w*|ingreso\w*|gana\w*|corto|quebrado|fiado)\b/i;
// "S/ 50", "s/50": la barra rompe el \b, así que la moneda va aparte
const CURRENCY_RE = /(^|[^a-z])s\/\s*\d/i;

/** ¿El mensaje toca dinero? (solo entonces se añade el bloque de finanzas) */
export function mentionsMoney(text = "") {
  const t = String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return MONEY_RE.test(t) || CURRENCY_RE.test(t);
}

/**
 * Hábitos de dinero del Mapa Neuronal de Finanzas (~100 palabras), solo si el mensaje
 * habla de dinero. Vacío si no hay movimientos.
 */
export function buildRecentFinanceBlock(userInput = "") {
  try {
    if (!mentionsMoney(userInput)) return "";
    const st = typeof globalThis !== "undefined" ? globalThis.state : null;
    const ledger = Array.isArray(st?.financeLedger) ? st.financeLedger : [];
    // Sin movimientos el bloque de hábitos queda vacío, pero el plan de quincenas igual se añade
    let block = ledger.length ? buildFinanceHabitsPromptBlock(ledger, { prefs: st?.financeMeta?.habitPrefs, accounts: st?.financeAccounts || [] }) : "";
    // Plan de quincenas del mes (Mission Control), si el usuario armó uno
    try {
      const d = new Date();
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const plan = st?.financeMeta?.quincenaPlans?.[mk];
      const fn = globalThis.financeMissionControlModel;
      if (plan && typeof fn === "function") {
        const card = buildQuincenaPlanCard(plan, fn(mk).items || [], { lastDay: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() });
        if (card) block += block ? `\n\n${card}` : `\n\n## PLAN DE DINERO DEL USUARIO\n${card}`;
      }
    } catch (_e) {}
    return block;
  } catch (_e) {
    return "";
  }
}
