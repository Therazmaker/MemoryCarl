/**
 * purchaseSplit.js — Una compra en Finanzas, por partes
 * MemoryCarl · Compras
 *
 * Una lista se puede registrar como un solo gasto ("con la compra") o separar algunas cosas
 * en su propio gasto con otra categoría (p. ej. la Pepsi en "Bebidas"). Lo que va a la misma
 * categoría se junta en un gasto. También detecta lo que ya parece estar anotado en Finanzas
 * (mismo monto y nombre, hoy o ayer) para no sumarlo dos veces.
 * Lógica pura.
 */

export const SPLIT_MAIN = "__compra__";
export const SPLIT_SKIP = "__ya_esta__";

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ ]/g, " ").replace(/\s+/g, " ").trim();
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const words = (s) => norm(s).split(" ").filter((w) => w.length >= 4 && !/^\d+$/.test(w));

/** Clave estable de un producto para recordar cómo se registra. */
export const itemKey = (it) => (it?.productId ? `p:${it.productId}` : `n:${norm(it?.name)}`);

/** Monto de una línea de compra. */
export const lineAmount = (it) => round2((Number(it?.price) || 0) * (Number(it?.qty) || 1));

/**
 * ¿Ya hay un gasto en Finanzas que parece este ítem? (mismo monto, nombre en la nota, hoy o ayer,
 * y que no venga de una compra de La Canasta)
 * @returns {object|null} el movimiento encontrado
 */
export function alreadyInFinance(item, ledger = [], now = new Date()) {
  const amount = lineAmount(item);
  if (!(amount > 0)) return null;
  const ws = words(item?.name);
  if (!ws.length) return null;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1).getTime();
  const to = now.getTime() + 60 * 60 * 1000;
  return (ledger || []).find((e) => {
    if (!e || e.archived || e.type !== "expense" || e.source === "shopping") return false;
    if (Math.abs((Number(e.amount) || 0) - amount) > 0.01) return false;
    const t = new Date(e.date).getTime();
    if (!Number.isFinite(t) || t < from || t > to) return false;
    const text = norm(`${e.note || ""} ${e.reason || ""} ${e.category || ""}`);
    return ws.some((w) => text.includes(w));
  }) || null;
}

/**
 * Elección inicial para cada ítem: lo que ya está en Finanzas se salta; si no, lo que se
 * eligió la última vez para ese producto; si no, con la compra.
 */
export function initialChoices(items = [], { ledger = [], habits = {}, categories = [], now = new Date() } = {}) {
  const out = {};
  const dupes = {};
  for (const it of items) {
    const dup = alreadyInFinance(it, ledger, now);
    if (dup) { out[it.id] = SPLIT_SKIP; dupes[it.id] = dup; continue; }
    const h = habits[itemKey(it)];
    out[it.id] = h && (h === SPLIT_MAIN || categories.includes(h)) ? h : SPLIT_MAIN;
  }
  return { choices: out, dupes };
}

/** Recuerda lo elegido para cada producto (solo lo que se separó o se volvió a juntar). */
export function rememberChoices(habits = {}, items = [], choices = {}) {
  const next = { ...habits };
  for (const it of items) {
    const c = choices[it.id];
    if (!c || c === SPLIT_SKIP) continue;
    const k = itemKey(it);
    if (c === SPLIT_MAIN) { if (next[k]) delete next[k]; }
    else next[k] = c;
  }
  return next;
}

/** Nota corta con los nombres. */
export function namesNote(items = [], store = "", emoji = "🧺") {
  const names = items.map((it) => String(it.name || "").trim()).filter(Boolean);
  const list = names.slice(0, 6).join(", ") + (names.length > 6 ? ` y ${names.length - 6} más` : "");
  return `${emoji} ${list || "Compra"}${store ? ` · ${store}` : ""}`;
}

/**
 * Arma los gastos a registrar.
 * @returns {Array<{ key: string, category: string, items: object[], amount: number, note: string }>}
 *   key "main" es el gasto de la compra; el resto, uno por categoría separada.
 */
export function buildFinanceGroups(items = [], choices = {}, { mainCategory = "Alimentos", store = "", mainNote = "" } = {}) {
  const main = [];
  const byCat = new Map();
  for (const it of items) {
    const c = choices[it.id] || SPLIT_MAIN;
    if (c === SPLIT_SKIP) continue;
    if (c === SPLIT_MAIN) { main.push(it); continue; }
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(it);
  }
  const groups = [];
  const sum = (arr) => round2(arr.reduce((s, it) => s + lineAmount(it), 0));
  if (main.length) groups.push({ key: "main", category: mainCategory, items: main, amount: sum(main), note: mainNote || namesNote(main, store) });
  for (const [cat, arr] of byCat) groups.push({ key: cat, category: cat, items: arr, amount: sum(arr), note: namesNote(arr, store, "➜") });
  return groups.filter((g) => g.amount > 0);
}
