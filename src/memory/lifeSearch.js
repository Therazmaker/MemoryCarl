/**
 * lifeSearch.js — Búsqueda en la historia del usuario (memorias y neuronas)
 * MemoryCarl / NeuroChat
 *
 * Lo usan las herramientas de Carl: él decide qué buscar y con qué palabras, y aquí
 * se busca localmente (gratis) con BM25 sobre texto normalizado:
 *   - sin acentos ni mayúsculas,
 *   - por raíz aproximada ("cansado", "cansancio", "cansada" → "cans…"),
 *   - las palabras raras pesan más que las comunes,
 *   - filtros por fecha.
 * Lógica pura: recibe las listas, no toca localStorage.
 */

const STOP = new Set(`
a al algo ante antes asi aun aunque bien cada como con contra cual cuando de del desde donde el ella ellas ellos en entre era es esa ese eso esta este esto estoy fue ha hay he la las le les lo los mas me mi mis mucho muy nada ni no nos o otra otro para pero poco por porque que quien se ser si sin sobre solo son su sus tan te tu tus un una uno unos unas y ya yo
`.split(/\s+/).filter(Boolean));

export function normalize(text = "") {
  return String(text || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9ñ\s]/g, " ");
}

/** Raíz aproximada para español: quita terminaciones comunes y corta a 6 letras. */
export function stem(word) {
  let w = word;
  if (w.length <= 3) return w;
  // 1) plural
  if (w.length > 4) w = w.replace(/(es|s)$/, "");
  // 2) derivadas (ansiedad, cansancio, rápidamente, decisión…)
  w = w.replace(/(amente|mente|aciones|acion|ciones|cion|iones|idades|idad|edad|ismo|ista|ancia|ancio|encia|oso|osa)$/, "");
  // 3) verbos y participios (cansado, trabajando, dormía…)
  w = w.replace(/(ando|iendo|ado|ada|ido|ida|aron|ieron|aba|aban|ia|ian|ar|er|ir)$/, "");
  // 4) vocal final
  if (w.length > 3) w = w.replace(/[aeo]$/, "");
  return (w.length >= 3 ? w : word).slice(0, 5);
}

export function terms(text = "") {
  return normalize(text).split(/\s+/).filter((t) => t.length >= 3 && !STOP.has(t)).map(stem);
}

/**
 * Índice BM25. docs: [{ id, fields: { [name]: string } }], boosts: { [name]: number }.
 */
export function buildIndex(docs = [], boosts = {}) {
  const index = [];
  const df = new Map();
  let totalLen = 0;
  for (const d of docs) {
    const tf = new Map();
    let len = 0;
    for (const [field, text] of Object.entries(d.fields || {})) {
      const b = boosts[field] ?? 1;
      for (const t of terms(text)) {
        tf.set(t, (tf.get(t) || 0) + b);
        len++;
      }
    }
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    totalLen += len;
    index.push({ id: d.id, tf, len });
  }
  return { index, df, N: docs.length, avgLen: totalLen / Math.max(1, docs.length) };
}

export function scoreIndex(idx, query, { k1 = 1.4, b = 0.7 } = {}) {
  const q = [...new Set(terms(query))];
  if (!q.length) return new Map();
  const out = new Map();
  for (const doc of idx.index) {
    let s = 0;
    let hits = 0;
    for (const t of q) {
      const f = doc.tf.get(t);
      if (!f) continue;
      hits++;
      const n = idx.df.get(t) || 0;
      const idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * doc.len) / (idx.avgLen || 1))));
    }
    // Premio a los que cubren varias palabras de la búsqueda
    if (s > 0) out.set(doc.id, s * (1 + 0.25 * (hits - 1)));
  }
  return out;
}

// Los límites pueden ser año ("2024"), mes ("2024-03") o día: se compara con el mismo largo,
// así "hasta 2024-03" incluye todo marzo.
function inRange(date, from, to) {
  const d = String(date || "").slice(0, 10);
  if (!d) return true;
  if (from && d.slice(0, from.length) < from) return false;
  if (to && d.slice(0, to.slice(0, 10).length) > to.slice(0, 10)) return false;
  return true;
}

/** Fragmento del texto alrededor de las palabras buscadas. */
export function snippetAround(text = "", query = "", size = 320) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= size) return clean;
  const q = new Set(terms(query));
  const words = clean.split(" ");
  const isHit = (w) => { const t = stem(normalize(w).trim()); return Boolean(t) && q.has(t); };
  // La ventana con más coincidencias; el fragmento empieza poco antes de la primera de ellas
  const win = Math.max(8, Math.round(size / 7));
  let bestStart = 0;
  let bestScore = 0;
  for (let i = 0; i < words.length; i++) {
    if (!isHit(words[i])) continue;
    let sc = 0;
    for (let j = i; j < Math.min(words.length, i + win); j++) if (isHit(words[j])) sc++;
    if (sc > bestScore) { bestScore = sc; bestStart = i; }
  }
  const start = Math.max(0, bestStart - 4);
  let out = words.slice(start).join(" ").slice(0, size);
  out = out.slice(0, out.lastIndexOf(" ") > size * 0.6 ? out.lastIndexOf(" ") : out.length);
  return `${start > 0 ? "…" : ""}${out}…`;
}

function memoryDocs(memories) {
  return memories.map((m) => ({
    id: m.id,
    fields: { title: m.title || "", tags: (m.tags || []).join(" "), text: m.text || "" },
  }));
}

/**
 * Busca memorias. Sin `query` devuelve las del rango de fechas (las más recientes primero).
 * @returns {Array<{ id, date, title, snippet, score, neurons: string[] }>}
 */
export function searchMemories(memories = [], { query = "", from = "", to = "", limit = 6 } = {}, neurons = []) {
  const pool = memories.filter((m) => m && m.text && inRange(m.date, from, to));
  const names = new Map(neurons.map((n) => [n.id, n.core?.concept || n.id]));
  let ranked;
  if (String(query).trim()) {
    const scores = scoreIndex(buildIndex(memoryDocs(pool), { title: 2.5, tags: 2, text: 1 }), query);
    ranked = pool.filter((m) => scores.has(m.id)).map((m) => ({ m, score: scores.get(m.id) })).sort((a, b) => b.score - a.score);
  } else {
    ranked = [...pool].sort((a, b) => String(b.date).localeCompare(String(a.date))).map((m) => ({ m, score: 0 }));
  }
  return ranked.slice(0, Math.max(1, Math.min(limit, 15))).map(({ m, score }) => ({
    id: m.id,
    date: m.date || "",
    title: m.title || "",
    snippet: snippetAround(m.text, query),
    score: Math.round(score * 100) / 100,
    neurons: (m.linkedNeurons || []).map((id) => names.get(id)).filter(Boolean).slice(0, 4),
  }));
}

/** Texto completo de una memoria. */
export function readMemory(memories = [], id, maxChars = 4000) {
  const m = memories.find((x) => x && x.id === id);
  if (!m) return null;
  const text = String(m.text || "");
  return { id: m.id, date: m.date || "", title: m.title || "", text: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text, tags: m.tags || [] };
}

/** Busca neuronas por concepto, resumen y triggers; incluye a qué están conectadas. */
export function searchNeurons(neurons = [], { query = "", limit = 6 } = {}) {
  const live = neurons.filter((n) => n && !n.deleted && n.core?.concept);
  if (!String(query).trim()) return [];
  const byId = new Map(live.map((n) => [n.id, n]));
  const idx = buildIndex(live.map((n) => ({
    id: n.id,
    fields: { concept: n.core.concept, triggers: (n.triggers || []).join(" "), summary: n.core.summary || "" },
  })), { concept: 3, triggers: 2, summary: 1 });
  const scores = scoreIndex(idx, query);
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).slice(0, Math.max(1, Math.min(limit, 12))).map(([id, score]) => {
    const n = byId.get(id);
    return {
      id,
      concept: n.core.concept,
      domain: n.core.domain || "general",
      summary: String(n.core.summary || "").slice(0, 280),
      past: Boolean(n.temporal?.isPast || n.temporal?.isHistorical),
      connectedTo: (n.connections || []).map((c) => byId.get(c)?.core?.concept).filter(Boolean).slice(0, 6),
      score: Math.round(score * 100) / 100,
    };
  });
}

/**
 * Línea de tiempo de la vida: cuántas memorias hay por mes o año (de un tema, si se da),
 * con sus palabras más repetidas y algunos títulos. Sirve para ver etapas y patrones.
 */
export function memoryTimeline(memories = [], { query = "", from = "", to = "", by = "month" } = {}) {
  let pool = memories.filter((m) => m && m.text && m.date && inRange(m.date, from, to));
  if (String(query).trim()) {
    const scores = scoreIndex(buildIndex(memoryDocs(pool), { title: 2.5, tags: 2, text: 1 }), query);
    pool = pool.filter((m) => scores.has(m.id));
  }
  const key = (d) => (by === "year" ? d.slice(0, 4) : d.slice(0, 7));
  const buckets = new Map();
  for (const m of pool) {
    const k = key(m.date);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(m);
  }
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([period, list]) => {
    const tagCount = new Map();
    for (const m of list) for (const t of m.tags || []) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    const emotions = new Map();
    for (const m of list) emotions.set(m.emotion || "neutral", (emotions.get(m.emotion || "neutral") || 0) + 1);
    return {
      period,
      count: list.length,
      topTags: [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([t]) => t),
      emotions: Object.fromEntries([...emotions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)),
      sampleTitles: list.slice(0, 4).map((m) => `${m.date}: ${String(m.title || "").slice(0, 70)}`),
    };
  });
}
