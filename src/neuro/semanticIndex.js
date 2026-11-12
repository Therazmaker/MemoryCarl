/**
 * semanticIndex.js — Huellas de significado (embeddings) de las neuronas
 * MemoryCarl / NeuroChat
 *
 * Guarda en el teléfono un vector por neurona (Voyage, 256 dimensiones) junto a un hash
 * de su texto: si la neurona cambia, se vuelve a calcular solo esa. No se sube a la nube;
 * cada dispositivo arma su índice.
 *
 * Las funciones de cálculo (texto, hash, tandas, puntajes) son puras y se prueban sin red.
 */

export const SEMANTIC_KEY = "memorycarl_semantic_index_v1";
const MAX_TOKENS_PER_BATCH = 7000;   // por debajo de 10.000 tokens/minuto
const BATCH_PAUSE_MS = 21_000;       // 3 llamadas por minuto como máximo

export function neuronEmbeddingText(n) {
  const summary = String(n?.core?.summary || "").replace(/\s+/g, " ").slice(0, 400);
  const triggers = (Array.isArray(n?.triggers) ? n.triggers : []).slice(0, 12).join(", ");
  return `${n?.core?.concept || ""}. ${summary}${triggers ? ` (${triggers})` : ""}`.trim();
}

export function textHash(str = "") {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return `${str.length}:${(h >>> 0).toString(36)}`;
}

export const estimateTokens = (text) => Math.ceil(String(text || "").length / 3.2) + 4;

/** Neuronas sin vector o con el texto cambiado. */
export function pendingNeurons(neurons = [], index = { items: {} }, model = "") {
  const items = index?.model === model ? index.items || {} : {};
  return neurons.filter((n) => n && n.id && !n.deleted && n.core?.concept)
    .filter((n) => items[n.id]?.h !== textHash(neuronEmbeddingText(n)));
}

/** Parte la lista en tandas que respetan el límite de tokens por llamada. */
export function makeBatches(neurons = [], maxTokens = MAX_TOKENS_PER_BATCH, maxItems = 128) {
  const batches = [];
  let cur = [];
  let tokens = 0;
  for (const n of neurons) {
    const t = estimateTokens(neuronEmbeddingText(n));
    if (cur.length && (tokens + t > maxTokens || cur.length >= maxItems)) {
      batches.push(cur);
      cur = [];
      tokens = 0;
    }
    cur.push(n);
    tokens += t;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

const round = (v) => v.map((x) => Math.round(x * 10000) / 10000);

export function cosine(a, b) {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/**
 * Convierte similitudes en señal 0..1 relativa al resto de neuronas: solo cuenta lo que
 * sobresale claramente del promedio (así "qué película vemos" no activa nada).
 */
export function semanticSignals(queryVec, index, ids = null, { margin = 0.08, span = 0.18 } = {}) {
  const items = index?.items || {};
  const entries = Object.entries(items).filter(([id]) => !ids || ids.has(id));
  if (!queryVec || entries.length < 3) return new Map();
  const sims = entries.map(([id, it]) => [id, cosine(queryVec, it.v)]);
  const mean = sims.reduce((s, [, c]) => s + c, 0) / sims.length;
  const out = new Map();
  for (const [id, c] of sims) {
    const signal = (c - mean - margin) / span;
    if (signal > 0) out.set(id, Math.min(1, signal));
  }
  return out;
}

// ---- Almacenamiento ----

export function loadSemanticIndex() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(SEMANTIC_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && parsed.items ? parsed : { model: "", items: {} };
  } catch (_e) {
    return { model: "", items: {} };
  }
}

export function saveSemanticIndex(index) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(SEMANTIC_KEY, JSON.stringify(index));
  } catch (_e) { /* sin espacio: se recalcula la próxima vez */ }
}

/** Quita del índice las neuronas que ya no existen. */
export function pruneIndex(index, neurons = []) {
  const alive = new Set(neurons.filter((n) => n && !n.deleted).map((n) => n.id));
  const items = {};
  for (const [id, it] of Object.entries(index.items || {})) if (alive.has(id)) items[id] = it;
  return { ...index, items };
}

let running = null;

/**
 * Calcula los vectores que faltan, en tandas con pausa. Se puede llamar seguido: si ya
 * está corriendo, devuelve la misma promesa.
 * @param {{ neurons: Array, embed: (texts: string[]) => Promise<{vectors: number[][]}>, model: string, onProgress?: Function, sleep?: Function }} opts
 */
export function indexNeurons({ neurons, embed, model, onProgress = () => {}, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (running) return running;
  running = (async () => {
    let index = pruneIndex(loadSemanticIndex(), neurons);
    if (index.model !== model) index = { model, items: {} };
    const pending = pendingNeurons(neurons, index, model);
    const batches = makeBatches(pending);
    let done = 0;
    onProgress({ done, total: pending.length });
    for (let b = 0; b < batches.length; b++) {
      if (b > 0) await sleep(BATCH_PAUSE_MS);
      const batch = batches[b];
      const texts = batch.map(neuronEmbeddingText);
      const { vectors } = await embed(texts);
      batch.forEach((n, i) => { index.items[n.id] = { h: textHash(texts[i]), v: round(vectors[i]) }; });
      index.updatedAt = new Date().toISOString();
      saveSemanticIndex(index);
      done += batch.length;
      onProgress({ done, total: pending.length });
    }
    saveSemanticIndex(index);
    return { indexed: done, total: Object.keys(index.items).length };
  })().finally(() => { running = null; });
  return running;
}

export function semanticIndexStatus(neurons = [], model = "") {
  const index = loadSemanticIndex();
  const live = neurons.filter((n) => n && !n.deleted && n.core?.concept);
  const pending = pendingNeurons(live, index, model).length;
  return { total: live.length, ready: live.length - pending, pending, updatedAt: index.updatedAt || null };
}
