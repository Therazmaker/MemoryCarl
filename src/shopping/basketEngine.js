/**
 * basketEngine.js — La Canasta: aprende cómo compra la casa (lógica pura)
 * MemoryCarl · Compras
 *
 * Sin pedirle a nadie "cuánto queda" de algo: aprende de cada cuánto se vuelve a
 * comprar cada producto (historial de compras) y con eso:
 *   - estima cuándo toca comprar de nuevo,
 *   - calcula la canasta mínima para pasar una semana,
 *   - analiza una lista pegada (de Fergis, de WhatsApp…) y la ordena en
 *     "hace falta", "puede esperar", "gusto" y "sin precio".
 * No toca localStorage ni la red.
 */

const DAY = 86_400_000;

export const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();

/** Singular aproximado para comparar ("huevos" → "huevo", "panes" → "pan"). */
function singular(w) {
  if (w.length > 4 && /[^aeiou]es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s")) return w.slice(0, -1);
  return w;
}
const keyWords = (s) => norm(s).split(" ").filter((w) => w.length >= 2 && !FILLER.has(w)).map(singular);
const FILLER = new Set(["de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "y", "con", "para", "por", "mas", "x"]);

export const itemKey = (it) => (it?.productId ? `p:${it.productId}` : `n:${keyWords(it?.name).join(" ")}`);

const UNIT_WORDS = {
  kg: "kg", kilo: "kg", kilos: "kg", kgs: "kg", g: "g", gr: "g", grs: "g", gramos: "g",
  l: "l", lt: "l", lts: "l", litro: "l", litros: "l", ml: "ml",
  u: "u", und: "u", unid: "u", unidad: "u", unidades: "u",
  paq: "paq", paquete: "paq", paquetes: "paq", bolsa: "bolsa", bolsas: "bolsa",
  plancha: "plancha", planchas: "plancha", docena: "docena", docenas: "docena", lata: "lata", latas: "lata",
};
const NUMBER_WORDS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, medio: 0.5, media: 0.5 };

// ---- Productos por peso (precio por kg en la biblioteca) ----

/** ¿El producto se vende por peso? (en la biblioteca su precio es por kg) */
export const isWeighed = (product) => /kg|kilo/i.test(String(product?.unit || ""));

/**
 * Una línea pesada a partir de lo que se sepa: lo pagado, los kg, o ambos.
 *   - pagado + kg → precio real por kg (se aprende)
 *   - solo pagado → kg estimados con el precio por kg de la biblioteca
 *   - solo kg     → lo que costó con el precio por kg de la biblioteca
 * @returns {{ paid: number, kg: number, pricePerKg: number, estimated: boolean } | null}
 */
export function weighedLine({ pricePerKg = 0, paid = 0, kg = 0 } = {}) {
  const ppk = Math.max(0, Number(pricePerKg) || 0);
  const pd = Math.max(0, Number(paid) || 0);
  const k = Math.max(0, Number(kg) || 0);
  if (pd > 0 && k > 0) return { paid: round2(pd), kg: round3(k), pricePerKg: round2(pd / k), estimated: false };
  if (pd > 0) return { paid: round2(pd), kg: ppk > 0 ? round3(pd / ppk) : 0, pricePerKg: round2(ppk), estimated: true };
  if (k > 0 && ppk > 0) return { paid: round2(k * ppk), kg: round3(k), pricePerKg: round2(ppk), estimated: false };
  return null;
}

/** Kg de una cantidad escrita ("500 g" → 0.5, "1.5 kg" → 1.5); null si no dice peso. */
export function kgFromWritten(qty, unit) {
  const q = Number(qty);
  if (!(q > 0)) return null;
  if (unit === "g") return round3(q / 1000);
  if (unit === "kg") return round3(q);
  return null;
}

/** Línea de historial pesada (formato compatible con la lista de compras): precio = lo pagado, qty 1. */
export function weighedHistoryFields(line) {
  return { price: line.paid, qty: 1, weight_g: Math.round(line.kg * 1000), pricePerKg: line.pricePerKg, unit: "g", ...(line.estimated ? { weightEstimated: true } : {}) };
}

/** Interpreta una cantidad suelta: "2", "1/2", "1.5", "dos". */
function parseQty(tok) {
  if (tok == null) return null;
  const t = String(tok).toLowerCase();
  if (NUMBER_WORDS[t] != null) return NUMBER_WORDS[t];
  if (/^\d+\/\d+$/.test(t)) { const [a, b] = t.split("/").map(Number); return b ? a / b : null; }
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Convierte texto libre en ítems. Acepta una cosa por línea, separadas por comas o
 * "y", con viñetas, checks o números de lista, y cantidades antes o después:
 * "2 kg arroz", "arroz 2kg", "huevos x2", "- 3 leches", "pan (6)".
 * @returns {Array<{ raw: string, name: string, qty: number|null, unit: string }>}
 */
export function parseListText(text = "") {
  const pieces = String(text || "")
    .replace(/\r/g, "")
    .split(/\n|;|,(?!\d)|\s+y\s+(?=\S)/i)
    .map((s) => s.trim())
    .filter(Boolean);
  const out = [];
  for (const raw of pieces) {
    // Encabezados ("Lista para el mercado:", "Compras de la semana") no son ítems
    if (/:\s*$/.test(raw) || /^(lista|compras?|mercado|para comprar)\b/i.test(norm(raw))) continue;
    let s = raw
      .replace(/^\s*(?:[-*•·▪◦✓✔☐☑✅⬜]|\[\s?[xX]?\s?\]|\d+[.)]\s)\s*/, "")
      .replace(/[¡!¿?:]+$/g, "")
      .trim();
    if (!s || s.length > 80) continue;
    let qty = null;
    let unit = "";
    // "(6)" o "x6" o "x 6" al final
    let m = s.match(/(?:\(\s*(\d+(?:[.,]\d+)?)\s*\)|\bx\s*(\d+(?:[.,]\d+)?))\s*$/i);
    if (m) { qty = parseQty(m[1] || m[2]); s = s.slice(0, m.index).trim(); }
    // cantidad + unidad al inicio: "2 kg de arroz", "dos paquetes de fideos", "1/2 kilo"
    m = s.match(/^(\d+\/\d+|\d+(?:[.,]\d+)?|un|una|uno|dos|tres|cuatro|cinco|seis|medio|media)\s*([a-zñ]+)?\s*(?:de\s+)?(.*)$/i);
    if (m && m[3]) {
      const u = m[2] ? UNIT_WORDS[m[2].toLowerCase()] : null;
      if (u || !m[2]) {
        qty = qty ?? parseQty(m[1]);
        unit = u || "";
        s = m[3].trim();
      } else if (parseQty(m[1]) != null && /^\d/.test(m[1])) {
        // "3 leches": número + palabra que no es unidad → es el nombre
        qty = qty ?? parseQty(m[1]);
        s = `${m[2]} ${m[3]}`.trim();
      }
    } else if (m && m[2] && !m[3]) {
      // "3 leches" sin más
      const u = UNIT_WORDS[m[2].toLowerCase()];
      if (!u && parseQty(m[1]) != null) { qty = parseQty(m[1]); s = m[2]; }
    }
    // cantidad + unidad al final: "arroz 2kg", "pollo 1 kilo"
    m = s.match(/^(.*?)\s+(\d+\/\d+|\d+(?:[.,]\d+)?)\s*([a-zñ]+)?$/i);
    if (m && m[1] && (!m[3] || UNIT_WORDS[m[3].toLowerCase()])) {
      qty = qty ?? parseQty(m[2]);
      unit = unit || (m[3] ? UNIT_WORDS[m[3].toLowerCase()] : "");
      s = m[1].trim();
    }
    const name = s.replace(/\s+/g, " ").replace(/^(de|del)\s+/i, "").trim();
    if (!name || !/[a-zñáéíóú]/i.test(name)) continue;
    out.push({ raw, name: name.charAt(0).toUpperCase() + name.slice(1), qty, unit });
  }
  return out;
}

/** Busca el producto de la biblioteca que corresponde a un nombre escrito. */
export function matchProduct(name, products = []) {
  const target = keyWords(name);
  if (!target.length) return null;
  const tKey = target.join(" ");
  let best = null;
  let bestScore = 0;
  for (const p of products) {
    if (!p || !p.name) continue;
    const pw = keyWords(p.name);
    if (!pw.length) continue;
    const pKey = pw.join(" ");
    let score = 0;
    if (pKey === tKey) score = 1;
    else {
      const set = new Set(pw);
      const common = target.filter((w) => set.has(w)).length;
      if (!common) continue;
      // todas las palabras escritas están en el producto ("arroz" → "Arroz Costeño 5kg")
      const coverage = common / target.length;
      const precision = common / pw.length;
      score = coverage * 0.75 + precision * 0.25;
      if (pw[0] === target[0]) score += 0.05;
    }
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return bestScore >= 0.7 ? best : null;
}

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const toDay = (d) => { const x = new Date(String(d).length <= 10 ? `${d}T12:00:00` : d); return Number.isNaN(x.getTime()) ? null : x; };
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Aprende el ritmo de compra de cada producto a partir del historial.
 * @param {Array} history - compras guardadas ({ date, items: [{ name, productId, qty, price, category }], buyer })
 * @returns {Map<string, object>} clave → { key, name, productId, category, purchases, intervalDays,
 *   avgQty, lastPrice, lastDate, daysSince, dueInDays, status, confidence, regularity, buyers }
 */
export function learnRhythm(history = [], { now = new Date(), products = [] } = {}) {
  const byKey = new Map();
  const productById = new Map(products.map((p) => [p.id, p]));
  for (const entry of history || []) {
    const day = toDay(entry?.date);
    if (!day) continue;
    for (const it of entry.items || []) {
      if (!it || !it.name) continue;
      const k = itemKey(it);
      if (!byKey.has(k)) byKey.set(k, { key: k, name: it.name, productId: it.productId || "", category: it.category || "", buys: [] });
      // Compras por peso: la cantidad son los kg y el precio es por kg (no el total pagado)
      const wkg = Number(it.weight_g) > 0 ? Number(it.weight_g) / 1000 : 0;
      const buy = wkg
        ? { qty: Math.max(0.01, wkg * (Number(it.qty) || 1)), price: Number(it.pricePerKg) || (Number(it.price) || 0) / wkg }
        : { qty: Math.max(0.01, Number(it.qty) || 1), price: Number(it.price) || 0 };
      byKey.get(k).buys.push({ t: day.getTime(), ...buy, buyer: entry.buyer || "" });
    }
  }
  const out = new Map();
  const nowT = (now instanceof Date ? now : new Date(now)).getTime();
  for (const g of byKey.values()) {
    // Compras del mismo día cuentan como una sola
    const days = new Map();
    for (const b of g.buys.sort((a, b2) => a.t - b2.t)) {
      const d = Math.floor(b.t / DAY);
      const prev = days.get(d);
      if (prev) { prev.qty += b.qty; prev.price = b.price || prev.price; }
      else days.set(d, { ...b });
    }
    const list = [...days.values()].sort((a, b) => a.t - b.t);
    const intervals = [];
    for (let i = 1; i < list.length; i++) intervals.push((list[i].t - list[i - 1].t) / DAY);
    const intervalDays = intervals.length ? Math.max(1, Math.round(median(intervals))) : null;
    const mean = intervals.length ? intervals.reduce((a, b) => a + b, 0) / intervals.length : 0;
    const sd = intervals.length > 1 ? Math.sqrt(intervals.reduce((s, x) => s + (x - mean) ** 2, 0) / intervals.length) : 0;
    const regularity = intervals.length > 1 && mean ? Math.max(0, Math.min(1, 1 - sd / mean)) : null;
    const last = list[list.length - 1];
    const daysSince = Math.max(0, Math.floor((nowT - last.t) / DAY));
    const dueInDays = intervalDays != null ? intervalDays - daysSince : null;
    let status = "sin_ritmo";
    if (intervalDays != null) status = dueInDays <= 0 ? "toca" : dueInDays <= 3 ? "pronto" : "tienes";
    const confidence = intervals.length >= 4 ? "alta" : intervals.length >= 2 ? "media" : intervals.length === 1 ? "baja" : "ninguna";
    const product = g.productId ? productById.get(g.productId) : null;
    const lastPrice = Number(product?.price) || [...list].reverse().find((b) => b.price > 0)?.price || 0;
    const buyers = {};
    for (const b of g.buys) if (b.buyer) buyers[b.buyer] = (buyers[b.buyer] || 0) + 1;
    out.set(g.key, {
      key: g.key,
      name: product?.name || g.name,
      productId: g.productId,
      category: product?.category || g.category || "",
      tier: product?.tier || "",
      essential: Boolean(product?.essential),
      purchases: list.length,
      intervalDays,
      avgQty: round2(list.reduce((s, b) => s + b.qty, 0) / list.length),
      lastPrice: round2(lastPrice),
      lastDate: new Date(last.t).toISOString().slice(0, 10),
      daysSince,
      dueInDays,
      status,
      confidence,
      regularity: regularity == null ? null : round2(regularity),
      buyers,
    });
  }
  return out;
}

// La clasificación del producto manda (una bebida "base_diario" como agua o leche es básica);
// la categoría y el nombre solo se usan si el producto no tiene nivel.
const isTreat = (s) => {
  const tier = String(s?.tier || "");
  if (/gusto|premio|premium/.test(tier)) return true;
  if (tier) return false;
  return /snack|golosin|dulce|gaseosa|licor|cerveza|antojo/i.test(`${s?.category || ""} ${s?.name || ""}`);
};

/**
 * Canasta mínima semanal: lo básico (no gustos) que se consume en 7 días, a precio actual.
 * Solo usa productos con ritmo conocido (al menos 2 compras).
 */
export function weeklyMinimum(rhythm) {
  const items = [];
  for (const s of rhythm.values()) {
    if (!s.intervalDays || !s.lastPrice || isTreat(s)) continue;
    const perWeek = (s.avgQty * 7) / s.intervalDays;
    items.push({ name: s.name, perWeek: round2(perWeek), cost: round2(perWeek * s.lastPrice), confidence: s.confidence });
  }
  items.sort((a, b) => b.cost - a.cost);
  const total = round2(items.reduce((a, b) => a + b.cost, 0));
  const known = items.filter((i) => i.confidence !== "baja").length;
  return { total, items, confidence: !items.length ? "ninguna" : known >= Math.max(3, items.length * 0.6) ? "media" : "baja" };
}

/**
 * Analiza una lista pegada. Cada ítem queda en un grupo:
 *   falta  → se necesita (le toca, o no hay datos para saber),
 *   espera → por el ritmo aprendido todavía no toca,
 *   gusto  → producto marcado como gusto/premio o categoría de antojos,
 *   sinprecio → no está en la biblioteca y nunca se compró: no se sabe el precio.
 */
export function analyzeList(parsed = [], { products = [], rhythm = new Map() } = {}) {
  const items = parsed.map((p, i) => {
    const product = matchProduct(p.name, products);
    const key = product ? `p:${product.id}` : `n:${keyWords(p.name).join(" ")}`;
    let stat = rhythm.get(key);
    if (!stat && product) stat = rhythm.get(`n:${keyWords(product.name).join(" ")}`);
    if (!stat) for (const s of rhythm.values()) if (matchProduct(p.name, [{ id: s.key, name: s.name }])) { stat = s; break; }
    const price = Number(product?.price) || stat?.lastPrice || 0;
    const weighed = isWeighed(product);
    // Por peso: la cantidad va en kg ("500 g" → 0.5); si no dice peso, lo de siempre o 1 kg
    const qty = weighed ? (kgFromWritten(p.qty, p.unit) ?? stat?.avgQty ?? 1) : (p.qty || stat?.avgQty || 1);
    const name = product?.name || stat?.name || p.name;
    let group = "falta";
    let reason = "";
    if (isTreat(product || stat)) {
      group = "gusto";
      reason = "Es un gusto";
    } else if (stat?.intervalDays && stat.confidence !== "baja" && stat.daysSince < stat.intervalDays * 0.6) {
      group = "espera";
      reason = `Compraron hace ${stat.daysSince} día${stat.daysSince === 1 ? "" : "s"}; suelen comprarlo cada ${stat.intervalDays} días`;
    } else if (stat?.intervalDays) {
      reason = stat.status === "toca" ? `Ya le toca (cada ~${stat.intervalDays} días)` : `Toca en ${Math.max(0, stat.dueInDays)} día${stat.dueInDays === 1 ? "" : "s"}`;
    } else if (!price) {
      group = "sinprecio";
      reason = "No está en la biblioteca: pon su precio al comprar";
    } else {
      reason = stat ? "Todavía aprendo su ritmo" : "Primera vez que lo veo en una compra";
    }
    return {
      id: `li${i}`,
      name,
      written: p.name,
      productId: product?.id || stat?.productId || "",
      category: product?.category || stat?.category || "",
      qty: weighed ? round3(qty) : round2(qty),
      unit: weighed ? "kg" : (p.unit || ""),
      weighed,
      price: round2(price),
      line: round2(price * qty),
      group,
      reason,
      essential: Boolean(product?.essential),
    };
  });
  const inList = new Set(items.map((it) => (it.productId ? `p:${it.productId}` : `n:${keyWords(it.name).join(" ")}`)));
  const listedNames = items.map((it) => it.name);
  // Lo que suele comprarse, ya toca, y no está en la lista
  const missing = [...rhythm.values()]
    .filter((s) => s.status === "toca" && s.confidence !== "baja" && !isTreat(s) && !inList.has(s.key)
      && !listedNames.some((n) => matchProduct(n, [{ id: "x", name: s.name }])))
    .sort((a, b) => a.dueInDays - b.dueInDays)
    .slice(0, 6)
    .map((s) => ({ name: s.name, productId: s.productId, price: s.lastPrice, qty: s.avgQty, overdue: -s.dueInDays, intervalDays: s.intervalDays }));
  const sum = (g) => round2(items.filter((it) => !g || g.includes(it.group)).reduce((a, b) => a + b.line, 0));
  return {
    items,
    missing,
    totals: { all: sum(null), needed: sum(["falta", "sinprecio"]), wait: sum(["espera"]), treats: sum(["gusto"]) },
  };
}

/** Gasto por semana (lunes a domingo) de las últimas N semanas, de la más vieja a la actual. */
export function weeklySpend(history = [], { weeks = 8, now = new Date() } = {}) {
  const today = new Date(now);
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7));
  const buckets = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * (weeks - 1 - i));
    return { start: start.toISOString().slice(0, 10), startT: start.getTime(), total: 0, byBuyer: {} };
  });
  for (const e of history || []) {
    const d = toDay(e?.date);
    if (!d) continue;
    const t = d.getTime();
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i].startT && t < buckets[i].startT + 7 * DAY) {
        const total = Number(e.totals?.total) || (e.items || []).reduce((s, it) => s + (Number(it.price) || 0) * (Number(it.qty) || 1), 0);
        buckets[i].total = round2(buckets[i].total + total);
        const who = e.buyer || "—";
        buckets[i].byBuyer[who] = round2((buckets[i].byBuyer[who] || 0) + total);
        break;
      }
    }
  }
  return buckets.map(({ startT, ...b }) => b);
}

/** Gasto por categoría en los últimos N días. */
export function categorySpend(history = [], { days = 30, now = new Date() } = {}) {
  const from = new Date(now).getTime() - days * DAY;
  const map = new Map();
  for (const e of history || []) {
    const d = toDay(e?.date);
    if (!d || d.getTime() < from) continue;
    for (const it of e.items || []) {
      const cat = String(it.category || "").trim() || "Sin categoría";
      map.set(cat, round2((map.get(cat) || 0) + (Number(it.price) || 0) * (Number(it.qty) || 1)));
    }
  }
  return [...map.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total);
}
