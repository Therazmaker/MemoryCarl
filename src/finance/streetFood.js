/**
 * streetFood.js — "¿Me alcanza?": comida en la calle contra lo que queda hasta el cobro
 * MemoryCarl · Finanzas / Compras
 *
 * Lógica pura:
 *   - runway: cuánto queda libre de verdad hasta el próximo cobro (caja real menos lo que
 *     vence antes de cobrar), por día, y cuánto de eso hace falta para comer en casa.
 *   - impact: qué pasa si se compra algo ahora (alcanza / justo / no llegan).
 *   - patrones: qué comidas se compran en la calle (desayuno, almuerzo, cena, snack del
 *     trabajo, merienda de los niños), cuánto, en qué días, comparado con lo normal.
 *
 * Las compras de comida en la calle se guardan como gastos de Finanzas con la categoría
 * "Comida en la calle" y el tipo de comida al inicio de la nota ("🍽️ Cena · pollo").
 */

import { routineNeed } from "./routines.js";

export const STREET_CATEGORY = "Comida en la calle";

export const MEAL_TYPES = [
  { id: "desayuno", label: "Desayuno", emoji: "🥐" },
  { id: "almuerzo", label: "Almuerzo", emoji: "🍛" },
  { id: "cena", label: "Cena", emoji: "🍗" },
  { id: "snack_trabajo", label: "Snack del trabajo", emoji: "☕" },
  { id: "merienda_ninos", label: "Merienda de los niños", emoji: "🧃" },
  { id: "otro", label: "Antojo / otro", emoji: "🍬" },
];
const MEAL_BY_ID = new Map(MEAL_TYPES.map((m) => [m.id, m]));
export const mealLabel = (id) => MEAL_BY_ID.get(id)?.label || "Otro";
export const mealEmoji = (id) => MEAL_BY_ID.get(id)?.emoji || "🍽️";

const DAY = 86_400_000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Adivina el tipo de comida por lo escrito y, si no, por la hora. */
export function guessMealType(desc = "", when = new Date()) {
  const t = norm(desc);
  if (/nin[oa]s|colegio|lonchera|merienda|hij[oa]s/.test(t)) return "merienda_ninos";
  if (/oficina|trabajo|chamba|cafe|snack|galleta|break/.test(t)) return "snack_trabajo";
  if (/desayun|pan con|tamal|sanguch|emoliente/.test(t)) return "desayuno";
  if (/almuerz|menu\b|menú/.test(t)) return "almuerzo";
  if (/cena|pollo a la brasa|chifa|pizza|hamburguesa|salchipapa|broaster/.test(t)) return "cena";
  const d = when instanceof Date ? when : new Date(when);
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 10.5) return "desayuno";
  if (h < 15.5) return "almuerzo";
  if (h < 18.5) return "snack_trabajo";
  return "cena";
}

/** Nota que se guarda en Finanzas: el tipo de comida va primero para poder aprender. */
export function streetNote(mealType, desc = "") {
  return `🍽️ ${mealLabel(mealType)}${desc ? ` · ${String(desc).trim()}` : ""}`;
}

/** Lee el tipo de comida de una nota guardada (o lo adivina por la hora del gasto). */
export function mealTypeOf(entry) {
  const m = String(entry?.note || "").match(/^🍽️\s*([^·]+?)\s*(?:·|$)/);
  if (m) {
    const found = MEAL_TYPES.find((t) => norm(t.label) === norm(m[1]));
    if (found) return found.id;
  }
  return guessMealType(entry?.note || "", entry?.date || new Date());
}

/** Gastos de comida en la calle dentro del ledger de Finanzas. */
export function streetEntries(ledger = []) {
  return (ledger || []).filter((e) => e && !e.archived && e.type === "expense"
    && (e.category === STREET_CATEGORY || /^🍽️/.test(String(e.note || ""))));
}

/** Próximo cobro: el 15 o el último día del mes (si hoy es día de cobro, se cuenta el siguiente). */
export function nextPayday(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  let date;
  if (d.getDate() < 15) date = new Date(d.getFullYear(), d.getMonth(), 15);
  else if (d.getDate() < lastDay) date = new Date(d.getFullYear(), d.getMonth(), lastDay);
  else date = new Date(d.getFullYear(), d.getMonth() + 1, 15);
  const daysLeft = Math.max(1, Math.round((date - d) / DAY));
  return { date, day: date.getDate(), daysLeft, label: date.getDate() === 15 ? "el 15" : `el ${date.getDate()}` };
}

const owed = (i) => {
  const p = Number(i?.pendingAmount);
  return Number.isFinite(p) && i.pendingAmount != null ? Math.max(0, p) : Math.max(0, Number(i?.amount) || 0);
};

/**
 * Cuánto queda libre hasta el próximo cobro.
 * @param {{ availableCash: number, items: Array, now?: Date, homeFoodPerWeek?: number }} input
 *   items: obligaciones del mes de Mission Control ({ name, dueDay, status, amount, pendingAmount }).
 */
export function runway({ availableCash = 0, items = [], now = new Date(), homeFoodPerWeek = 0, routines = [] } = {}) {
  const pay = nextPayday(now);
  const today = now.getDate();
  const sameMonth = pay.date.getMonth() === now.getMonth();
  // Lo pendiente que vence antes del cobro (o ya venció) se paga con lo que hay ahora
  const due = (items || []).filter((i) => i && i.status !== "paid" && owed(i) > 0
    && (!sameMonth || Number(i.dueDay || 0) < pay.day || Number(i.dueDay || 0) < today));
  const pending = round2(due.reduce((s, i) => s + owed(i), 0));
  const free = round2(Number(availableCash || 0) - pending);
  const homeFoodNeed = round2((Number(homeFoodPerWeek) || 0) / 7 * pay.daysLeft);
  // Rutinas protegidas (bebidas del trabajo…): se apartan hasta el cobro
  const routine = routineNeed(routines, now, pay.date);
  return {
    payday: pay,
    cash: round2(availableCash),
    pending,
    dueItems: due.map((i) => ({ name: i.name, amount: round2(owed(i)), dueDay: i.dueDay })).sort((a, b) => (a.dueDay || 0) - (b.dueDay || 0)),
    free,
    perDay: round2(free / pay.daysLeft),
    homeFoodNeed,
    routine,
    // lo que queda después de asegurar la comida de casa y las rutinas
    extra: round2(free - homeFoodNeed - routine.total),
  };
}

/** Qué pasa si se gasta `amount` ahora. */
export function impact(rw, amount) {
  const a = Math.max(0, Number(amount) || 0);
  const freeAfter = round2(rw.free - a);
  const extraAfter = round2(rw.extra - a);
  const perDayAfter = round2(freeAfter / rw.payday.daysLeft);
  let status = "ok";
  if (freeAfter < 0 || extraAfter < 0) status = "no";
  else if (extraAfter < Math.max(20, rw.homeFoodNeed * 0.15)) status = "justo";
  return { amount: round2(a), freeAfter, extraAfter, perDayAfter, status };
}

function weekStart(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return new Date(x.getFullYear(), x.getMonth(), x.getDate() - ((x.getDay() + 6) % 7));
}

/**
 * Patrones de comida en la calle.
 * @returns {{ week: object, typical: object, month: number, monthCount: number, byType: Array, insights: string[] }}
 */
export function streetPatterns(entries = [], { now = new Date(), skipped = [] } = {}) {
  const ws = weekStart(now).getTime();
  const rows = entries.map((e) => ({ t: new Date(e.date).getTime(), amount: Number(e.amount) || 0, type: mealTypeOf(e), d: new Date(e.date) }))
    .filter((r) => Number.isFinite(r.t));
  const week = {};
  const prior = {};
  for (const m of MEAL_TYPES) { week[m.id] = { count: 0, total: 0 }; prior[m.id] = { count: 0, total: 0 }; }
  const PRIOR_WEEKS = 4;
  for (const r of rows) {
    if (r.t >= ws) { week[r.type].count++; week[r.type].total += r.amount; }
    else if (r.t >= ws - PRIOR_WEEKS * 7 * DAY) { prior[r.type].count++; prior[r.type].total += r.amount; }
  }
  const typical = {};
  for (const m of MEAL_TYPES) typical[m.id] = { count: round2(prior[m.id].count / PRIOR_WEEKS), total: round2(prior[m.id].total / PRIOR_WEEKS) };
  const monthRows = rows.filter((r) => r.d.getMonth() === now.getMonth() && r.d.getFullYear() === now.getFullYear());
  const month = round2(monthRows.reduce((s, r) => s + r.amount, 0));
  const weekTotal = round2(Object.values(week).reduce((s, w) => s + w.total, 0));
  const typicalTotal = round2(Object.values(typical).reduce((s, w) => s + w.total, 0));

  const insights = [];
  for (const m of MEAL_TYPES) {
    const w = week[m.id];
    const t = typical[m.id];
    if (w.count >= 2 && w.count >= Math.ceil(t.count) + 2) {
      insights.push(`Esta semana ya van ${w.count} ${m.label.toLowerCase()}${w.count === 1 ? "" : "s"} en la calle (${round2(w.total)} soles); lo normal es ${t.count < 1 ? "menos de 1" : Math.round(t.count)}.`);
    }
  }
  // Día de la semana que se repite (últimas 5 semanas)
  const recent = rows.filter((r) => r.t >= ws - 5 * 7 * DAY);
  const byDowType = new Map();
  for (const r of recent) {
    const k = `${r.d.getDay()}|${r.type}`;
    if (!byDowType.has(k)) byDowType.set(k, new Set());
    byDowType.get(k).add(weekStart(r.d).getTime());
  }
  for (const [k, weeks] of byDowType) {
    if (weeks.size >= 3) {
      const [dow, type] = k.split("|");
      insights.push(`Los ${DOW[Number(dow)]} suele haber ${mealLabel(type).toLowerCase()} en la calle (${weeks.size} de las últimas 5 semanas).`);
    }
  }
  const skippedMonth = (skipped || []).filter((s) => { const d = new Date(s.ts); return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear(); });
  if (skippedMonth.length) insights.push(`Este mes dijeron “mejor no” ${skippedMonth.length} ${skippedMonth.length === 1 ? "vez" : "veces"}: ${round2(skippedMonth.reduce((s, x) => s + (Number(x.amount) || 0), 0))} soles que siguen en casa. 💪`);

  return {
    week, typical, weekTotal, typicalTotal, month, monthCount: monthRows.length,
    byType: MEAL_TYPES.map((m) => ({ ...m, week: week[m.id], typical: typical[m.id] })),
    insights,
  };
}

/**
 * ¿El mensaje es "voy a gastar en comida fuera"? Saca el monto (suma todo lo que cuesta) y el tipo de comida.
 * "Voy a comprar almuerzo en la calle. Cuesta 12.10 más una Pepsi 750ml a 2.90" → { amount: 15, mealType: "almuerzo" }
 * Las medidas (750ml, 1kg, 2L) no cuentan como plata.
 * @returns {{ amount: number, desc: string, mealType: string } | null}
 */
export function parseSpendIntent(text = "", when = new Date()) {
  const t = norm(text);
  const intent = /\b(voy a|vamos a|quiero|queremos|me provoca|nos provoca|pienso|pensamos|puedo|podemos|estoy por)\b.*\b(compr|pedir|pido|gastar|comer|almorzar|cenar|desayunar)/.test(t)
    || /\b(me|nos) alcanza\b/.test(t)
    || /\b(cuesta|cuestan|sale|salen|vale|valen)\b/.test(t);
  const food = /\b(almuerz|almorzar|cena|cenar|desayun|merienda|lonche|snack|menu|comida|calle|delivery|pollo|chifa|pizza|hamburguesa|broaster|salchipapa|sanguch|cafe|bebida|gaseosa|pepsi|coca|inca|jugo|postre|helado)/.test(t);
  if (!intent || !food) return null;
  // Montos: números que no son medidas, horas ni cantidades de gente
  const UNIT_AFTER = /^\s*(ml|cc|g|gr|grs|gramos|kg|kilos?|l|lt|lts|litros?|oz|cm|x\b|:|%|am\b|pm\b|hrs?\b|horas|min|personas|platos|dias|d\b)/;
  const found = [];
  const re = /\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(t))) {
    const end = m.index + m[0].length;
    if (UNIT_AFTER.test(t.slice(end))) continue;
    // "para 4", "somos 3", "entre los 2": cantidad de gente, no plata
    if (/\b(para|somos|seremos|entre)\s+(los\s+|las\s+)?$/.test(t.slice(0, m.index))) continue;
    found.push({ n: Number(m[0].replace(",", ".")), int: !/[.,]/.test(m[0]), index: m.index, end });
  }
  const nums = [];
  for (let i = 0; i < found.length; i++) {
    const cur = found[i];
    const next = found[i + 1];
    // "2 pollos a 30" → 2 × 30
    if (next && cur.int && cur.n <= 20 && /^\s+[a-zñ]+(\s+[a-zñ]+){0,3}\s+(a|de|por|x)\s+(s\/\.?\s*)?$/.test(t.slice(cur.end, next.index))) {
      nums.push(cur.n * next.n);
      i++;
      continue;
    }
    if (cur.n > 0 && cur.n < 5000) nums.push(cur.n);
  }
  if (!nums.length) return null;
  const amount = round2(nums.reduce((s, n) => s + n, 0));
  const desc = String(text).replace(/\s+/g, " ").trim().slice(0, 80);
  return { amount, desc, mealType: guessMealType(text, when) };
}
