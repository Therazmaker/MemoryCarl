/**
 * semanticQuery.js — Puente entre el chat y la búsqueda por significado (Voyage)
 * MemoryCarl / NeuroChat
 *
 * - semanticSignalsFor(texto): huella del mensaje y señal 0..1 por neurona. Si Voyage no
 *   está configurado, tarda o falla, devuelve un mapa vacío y el chat sigue con palabras.
 * - ensureSemanticIndex(): indexa en segundo plano las neuronas nuevas o cambiadas.
 */

import { embedTexts, isVoyageConfigured, VOYAGE_MODEL } from "../services/voyageClient.js";
import { indexNeurons, loadSemanticIndex, semanticSignals, semanticIndexStatus } from "./semanticIndex.js";

const QUERY_TIMEOUT_MS = 3500;
let lastIndexError = null;
let cooldownUntil = 0;

export function getSemanticStatus(neurons) {
  return { configured: isVoyageConfigured(), ...semanticIndexStatus(neurons, VOYAGE_MODEL), lastError: lastIndexError };
}

export async function semanticSignalsFor(text, { neuronIds = null } = {}) {
  if (!isVoyageConfigured() || !String(text || "").trim() || Date.now() < cooldownUntil) return new Map();
  const index = loadSemanticIndex();
  if (index.model !== VOYAGE_MODEL || Object.keys(index.items || {}).length < 3) return new Map();
  try {
    const { vectors } = await embedTexts([String(text).slice(0, 2000)], { inputType: "query", timeoutMs: QUERY_TIMEOUT_MS });
    return semanticSignals(vectors[0], index, neuronIds);
  } catch (err) {
    // Límite por minuto: se descansa un rato para no frenar el chat
    if (err?.status === 429) cooldownUntil = Date.now() + 30_000;
    console.warn("[semantic] sin búsqueda por significado en este mensaje:", err?.message || err);
    return new Map();
  }
}

/** Indexa lo pendiente en segundo plano. No lanza errores. */
let indexRetryAt = 0;

export function ensureSemanticIndex(neurons, { onProgress, force = false } = {}) {
  if (!isVoyageConfigured()) return Promise.resolve(null);
  // Tras un fallo, los mensajes siguientes no reintentan enseguida (el botón sí puede)
  if (!force && Date.now() < indexRetryAt) return Promise.resolve(null);
  return indexNeurons({
    neurons,
    model: VOYAGE_MODEL,
    embed: (texts) => embedTexts(texts, { inputType: "document", timeoutMs: 30_000 }),
    onProgress,
  }).then((r) => { lastIndexError = null; indexRetryAt = 0; return r; })
    .catch((err) => {
      lastIndexError = err?.message || String(err);
      indexRetryAt = Date.now() + (err?.status === 429 ? 2 * 60_000 : 5 * 60_000);
      console.warn("[semantic] indexado pausado:", lastIndexError);
      return null;
    });
}
