/**
 * productLibrarySync.js — La biblioteca de productos segura en la nube
 * MemoryCarl · Compras
 *
 * La biblioteca (precios, categorías, unidades) se guarda en Supabase como su propio módulo
 * (`product_library` en app_modules) y nunca se sube vacía: una biblioteca vacía en el teléfono
 * no pisa la copia buena de la nube. Al bajar de la nube se UNE con lo local (no reemplaza).
 *
 * Si no hay copia en la nube, se puede reconstruir con lo que se compró (historial y listas).
 * Lógica pura.
 */

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const stamp = (p) => String(p?.updatedAt || p?.history?.[p.history.length - 1]?.date || "");

/**
 * Une dos bibliotecas sin perder nada. Por id (o por nombre si no coincide el id):
 * se queda la versión más reciente y se juntan los historiales de precio.
 * @returns {{ products: object[], added: number, updated: number }}
 */
export function mergeProducts(local = [], cloud = []) {
  const out = (Array.isArray(local) ? local : []).filter(Boolean).map((p) => ({ ...p }));
  const byId = new Map(out.filter((p) => p.id).map((p) => [String(p.id), p]));
  const byName = new Map(out.map((p) => [norm(p.name), p]));
  let added = 0;
  let updated = 0;
  for (const c of Array.isArray(cloud) ? cloud : []) {
    if (!c || !c.name) continue;
    const mine = (c.id && byId.get(String(c.id))) || byName.get(norm(c.name));
    if (!mine) {
      const copy = { ...c };
      out.push(copy);
      if (copy.id) byId.set(String(copy.id), copy);
      byName.set(norm(copy.name), copy);
      added++;
      continue;
    }
    // Historiales de precio juntos (sin repetir)
    const hist = [...(mine.history || []), ...(c.history || [])];
    const seen = new Set();
    const mergedHist = hist.filter((h) => { const k = `${h?.date}|${h?.price}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => String(a?.date || "").localeCompare(String(b?.date || "")));
    if (stamp(c) > stamp(mine)) {
      Object.assign(mine, { ...c, id: mine.id || c.id });
      updated++;
    }
    if (mergedHist.length !== (mine.history || []).length) mine.history = mergedHist;
  }
  return { products: out, added, updated };
}

/** Une listas de registros por id (historial de compras, listas): agrega los que falten. */
export function mergeById(local = [], cloud = []) {
  const out = Array.isArray(local) ? [...local] : [];
  const ids = new Set(out.map((x) => x && x.id).filter(Boolean).map(String));
  let added = 0;
  for (const c of Array.isArray(cloud) ? cloud : []) {
    if (!c || !c.id || ids.has(String(c.id))) continue;
    out.push(c);
    ids.add(String(c.id));
    added++;
  }
  return { list: out, added };
}

/** Lo que se sube a la nube; null si la biblioteca está vacía (así nunca pisa la copia buena). */
export function libraryPayload(products = []) {
  const list = (Array.isArray(products) ? products : []).filter((p) => p && p.name);
  if (!list.length) return null;
  return { products: list, count: list.length, savedAt: new Date().toISOString() };
}

/**
 * Reconstruye productos con lo comprado: historial de compras y listas.
 * Cada producto queda con su último precio, categoría, unidad (kg si se compró por peso)
 * y su historial de precios. No toca los que ya existen.
 * @returns {{ products: object[], added: number }}
 */
export function rebuildFromPurchases({ history = [], lists = [], existing = [], uid = () => `p_${Math.random().toString(36).slice(2, 10)}` } = {}) {
  const known = new Set((existing || []).map((p) => norm(p?.name)));
  const byName = new Map();
  const seen = (it, date, store) => {
    const name = String(it?.name || "").trim();
    if (!name) return;
    const k = norm(name);
    if (known.has(k)) return;
    const weighed = Number(it.weight_g) > 0 || Number(it.pricePerKg) > 0;
    const price = weighed ? (Number(it.pricePerKg) || (Number(it.price) / (Number(it.weight_g) / 1000)) || 0) : Number(it.price) || 0;
    if (!byName.has(k)) byName.set(k, { name, category: it.category || "", unit: weighed ? "kg" : (it.unit && it.unit !== "g" ? it.unit : "u"), essential: Boolean(it.essential), prices: [], store: store || "", id: it.productId || "" });
    const p = byName.get(k);
    if (!p.category && it.category) p.category = it.category;
    if (!p.id && it.productId) p.id = it.productId;
    if (price > 0) p.prices.push({ price: Math.round(price * 100) / 100, date: date || "" });
    if (store && !p.store) p.store = store;
  };
  for (const e of history || []) for (const it of e?.items || []) seen(it, e?.date, e?.store);
  for (const l of lists || []) for (const it of l?.items || []) seen(it, l?.updatedAt || l?.createdAt || "", "");
  const products = [...byName.values()].map((p) => {
    const prices = p.prices.filter((x) => x.price > 0).sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const last = prices[prices.length - 1];
    return {
      id: p.id || uid(),
      name: p.name,
      price: last ? last.price : 0,
      category: p.category,
      unit: p.unit,
      essential: p.essential,
      store: p.store,
      history: prices.slice(0, -1).map((x) => ({ price: x.price, date: x.date })),
      rebuiltFrom: "compras",
      updatedAt: new Date().toISOString(),
    };
  });
  return { products, added: products.length };
}
