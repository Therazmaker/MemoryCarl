/**
 * routines.js — Rutinas protegidas (lo que se compra siempre y es importante)
 * MemoryCarl · Compras / Finanzas
 *
 * Ej.: "mis bebidas del trabajo: Volt 2.50 y café 3, de lunes a viernes".
 * La rutina no se vigila ni se cuestiona: se APARTA. Hasta el próximo cobro se reserva lo
 * que cuesta, igual que la comida de casa, y "¿Me alcanza?" avisa si un gasto se la comería.
 *
 * Se guarda en el producto de la biblioteca: product.routine = { qty, days: [0..6], label }.
 * Lógica pura.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export const WEEKDAYS = [1, 2, 3, 4, 5];
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
const DAY_NAMES = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export function daysLabel(days = []) {
  const s = [...new Set(days)].sort().join(",");
  if (s === "0,1,2,3,4,5,6") return "todos los días";
  if (s === "1,2,3,4,5") return "lunes a viernes";
  if (s === "0,6") return "fines de semana";
  return days.map((d) => DAY_NAMES[d]).join(", ");
}

/** ¿El texto describe una rutina? ("siempre compro", "todos los días", "en el trabajo"…) */
export function looksLikeRoutine(text = "") {
  const t = norm(text);
  return /\brutina\b|todos los dias|cada dia|diario|siempre compro|de lunes a viernes|lunes a viernes|dias de semana|dias laborables|en el trabajo|en la oficina|en la chamba/.test(t)
    && /\d/.test(t);
}

function parseDays(t) {
  if (/fin(es)? de semana|sabado y domingo/.test(t)) return [0, 6];
  if (/todos los dias|cada dia|diario|toda la semana/.test(t)) return ALL_DAYS;
  return WEEKDAYS; // trabajo / oficina / lunes a viernes / días de semana
}

/**
 * Lee las cosas y precios de una frase de rutina.
 * "Volt 2.50 y café 3 de lunes a viernes" → [{ name: "Volt", price: 2.5, qty: 1 }, { name: "Café", price: 3, qty: 1 }]
 * "2 volt a 2.50" → qty 2, price 2.5
 */
export function parseRoutineText(text = "") {
  const t = norm(text);
  const days = parseDays(t);
  const label = /trabajo|oficina|chamba/.test(t) ? "Trabajo" : "";
  const body = String(text)
    .replace(/^[^:]*:\s*/, (m) => (/\d/.test(m) ? m : "")) // quita "Mis bebidas del trabajo:"
    .replace(/\b(de\s+)?lunes a viernes\b|\btodos los d[ií]as\b|\bcada d[ií]a\b|\bdiario\b|\bd[ií]as de semana\b|\bfines? de semana\b|\ben (el|la) (trabajo|oficina|chamba)\b/gi, " ")
    .replace(/\b(siempre|compro|tomo|me compro|mis|mi|bebidas?|del|de la|rutina|son|es)\b/gi, " ");
  const out = [];
  for (const piece of body.split(/,|;|\n|\s+y\s+|\s+\+\s+/i)) {
    const p = piece.trim();
    if (!p) continue;
    // "2 volt a 2.50", "volt 2.50", "café s/ 3", "1 café 3 soles"
    const m = p.match(/^(?:(\d+)\s*(?:x\s*)?)?([a-zñáéíóú][a-zñáéíóú0-9 .'-]*?)\s*(?:a|de|por|=|:)?\s*(?:s\/\.?\s*)?(\d+(?:[.,]\d+)?)\s*(?:soles|sol)?$/i);
    if (!m) continue;
    const name = m[2].trim().replace(/\s+/g, " ");
    if (!name || /^(a|de|por)$/i.test(name)) continue;
    out.push({ name: name.charAt(0).toUpperCase() + name.slice(1), price: round2(Number(m[3].replace(",", "."))), qty: Number(m[1]) || 1, days, label });
  }
  return out;
}

/** Rutinas guardadas en la biblioteca. */
export function routinesOf(products = []) {
  return (products || []).filter((p) => p && p.routine && Array.isArray(p.routine.days) && p.routine.days.length)
    .map((p) => ({ productId: p.id, name: p.name, price: round2(p.price), qty: Number(p.routine.qty) || 1, days: p.routine.days, label: p.routine.label || "" }));
}

/** Cuántos días de la rutina hay desde hoy (incluido) hasta antes del cobro. */
export function routineDaysUntil(days = [], now = new Date(), until = new Date()) {
  const set = new Set(days);
  let n = 0;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(until.getFullYear(), until.getMonth(), until.getDate());
  while (d < end) {
    if (set.has(d.getDay())) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** Lo que cuesta mantener las rutinas hasta el cobro. */
export function routineNeed(routines = [], now = new Date(), payday = new Date()) {
  const items = routines.map((r) => {
    const n = routineDaysUntil(r.days, now, payday);
    return { ...r, daysCount: n, cost: round2(r.price * r.qty * n) };
  });
  return { total: round2(items.reduce((s, i) => s + i.cost, 0)), items };
}
