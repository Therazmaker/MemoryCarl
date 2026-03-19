/**
 * utils.js — Utilidades compartidas para el módulo NeuroChat
 * MemoryCarl
 */

/**
 * Tokeniza texto en palabras limpias (minúsculas, sin puntuación).
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  if (!text || typeof text !== "string") return [];
  return text
    .toLowerCase()
    .replace(/[^\w\sáéíóúüñ]/gi, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

/**
 * Calcula una puntuación de coincidencia de keywords entre dos conjuntos de tokens.
 * @param {string[]} queryTokens
 * @param {string[]} docTokens
 * @returns {number} [0, 1]
 */
export function keywordOverlap(queryTokens, docTokens) {
  if (!queryTokens.length || !docTokens.length) return 0;
  const docSet = new Set(docTokens);
  const hits = queryTokens.filter((t) => docSet.has(t)).length;
  return hits / queryTokens.length;
}

/**
 * Clampea un número al rango [min, max].
 */
export function clamp(n, min = 0, max = 1) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Normaliza un array de números al rango [0, 1].
 * @param {number[]} values
 * @returns {number[]}
 */
export function normalizeArray(values) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return values.map(() => 0.5);
  return values.map((v) => (v - min) / (max - min));
}

/**
 * Parsea JSON de forma segura.
 * @param {string|any} raw
 * @param {any} fallback
 * @returns {any}
 */
export function safeParse(raw, fallback = null) {
  if (typeof raw !== "string") return fallback;
  try { return JSON.parse(raw); } catch (_e) { return fallback; }
}

/**
 * Construye un set de tokens únicos desde múltiples campos de una neurona.
 * @param {Neuron} n
 * @returns {Set<string>}
 */
export function neuronTokenSet(n) {
  const parts = [
    n.core?.concept   || "",
    n.core?.domain    || "",
    n.core?.summary   || "",
    ...(n.triggers    || []),
    ...(n.evidence    || []),
  ];
  const tokens = parts.flatMap((p) => tokenize(p));
  return new Set(tokens);
}

/**
 * Devuelve la fecha ISO de hace N días.
 * @param {number} days
 * @returns {string}
 */
export function daysAgoISO(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Devuelve la diferencia en días entre ahora y una fecha ISO.
 * @param {string|null} isoDate
 * @returns {number} días (positivo = pasado)
 */
export function daysSince(isoDate) {
  if (!isoDate) return Infinity;
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return Infinity;
  return (Date.now() - then) / (1000 * 60 * 60 * 24);
}

/**
 * Trunca un string a maxLen caracteres añadiendo "..." si es necesario.
 */
export function truncate(str, maxLen = 120) {
  if (!str || str.length <= maxLen) return str || "";
  return str.slice(0, maxLen) + "…";
}

/**
 * Genera un UUID v4 simple.
 */
export function uuid4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
