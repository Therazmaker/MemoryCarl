/**
 * embeddings.js — Interfaz de embeddings con fallback local determinístico
 * NeuroChat / MemoryCarl
 *
 * TODO: Reemplazar getEmbedding() con llamada real a endpoint de embeddings
 *       (ej. NeuroClaw /embed o Gemini Embedding API) cuando esté disponible.
 *
 * El fallback local convierte texto en un vector de 64 dimensiones usando
 * hashing de tokens. Es determinístico pero no semánticamente rico; permite
 * que el sistema funcione sin backend de embeddings.
 */

import { tokenize } from "./utils.js";

const VECTOR_DIM = 64;

// ---- Fallback local: hash-vector determinístico ----

/**
 * Hash simple de un string → número entero.
 * @param {string} str
 * @returns {number}
 */
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) ^ str.charCodeAt(i);
    h = h >>> 0; // convertir a uint32
  }
  return h;
}

/**
 * Convierte un string en un vector de dimensión VECTOR_DIM usando hashing.
 * @param {string} text
 * @returns {number[]}
 */
function localEmbedding(text) {
  const tokens = tokenize(text);
  const vec = new Array(VECTOR_DIM).fill(0);
  if (!tokens.length) return vec;

  for (const token of tokens) {
    const h = hashStr(token);
    for (let d = 0; d < VECTOR_DIM; d++) {
      // Genera un valor pseudo-aleatorio basado en token + dimensión
      const seed = hashStr(`${token}_${d}`);
      // Mapeo a [-1, 1]
      const val = ((seed % 1000) / 500) - 1;
      vec[d] += val;
    }
  }

  // L2 normalize
  return l2Normalize(vec);
}

/**
 * Normaliza un vector a longitud 1 (L2).
 * @param {number[]} vec
 * @returns {number[]}
 */
function l2Normalize(vec) {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map((v) => v / norm);
}

// ---- API pública ----

/**
 * Obtiene el embedding de un texto.
 * Si hay un endpoint real configurado (via neuroclawClient), se puede usar;
 * de lo contrario usa el fallback local.
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(text) {
  if (!text || typeof text !== "string") return new Array(VECTOR_DIM).fill(0);

  // TODO: Cuando el endpoint de embeddings esté listo, reemplazar por:
  // const { fetchEmbedding } = await import("../services/neuroclawClient.js");
  // try {
  //   const result = await fetchEmbedding(text);
  //   if (Array.isArray(result) && result.length > 0) return result;
  // } catch (_e) { /* fallback */ }

  return localEmbedding(text);
}

/**
 * Calcula la similitud coseno entre dos vectores.
 * @param {number[]} a
 * @param {number[]} b
 * @returns {number} [0, 1] (0 = opuesto, 0.5 = ortogonal, 1 = idéntico)
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return 0;
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;

  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  // Mapear de [-1, 1] a [0, 1]
  return (dot / (Math.sqrt(normA) * Math.sqrt(normB)) + 1) / 2;
}

/**
 * Calcula similarity directamente desde texto (getEmbedding + cosineSimilarity).
 * @param {string} textA
 * @param {string} textB
 * @returns {Promise<number>}
 */
export async function textSimilarity(textA, textB) {
  const [embA, embB] = await Promise.all([getEmbedding(textA), getEmbedding(textB)]);
  return cosineSimilarity(embA, embB);
}
