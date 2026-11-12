/**
 * voyageClient.js — Embeddings de Voyage AI (búsqueda por significado)
 * MemoryCarl / NeuroChat
 *
 * La API de Voyage acepta llamadas desde el navegador (CORS), así que la clave vive en
 * los ajustes de NeuroChat igual que la de Claude. Sin método de pago, Voyage limita la
 * cuenta a 3 llamadas y 10.000 tokens por minuto: el indexado va en tandas con pausa.
 */

import { getNeuroChatSettings } from "../settings/neurochatSettings.js";

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
export const VOYAGE_MODEL = "voyage-4";
export const VOYAGE_DIM = 256;

export class VoyageError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

export function getVoyageKey() {
  return String(getNeuroChatSettings().voyageApiKey || "").trim();
}

export function isVoyageConfigured() {
  return getVoyageKey().length > 10;
}

function friendly(status, msg = "") {
  if (status === 401 || status === 403) return "La clave de Voyage no es válida.";
  if (status === 429) return "Voyage pidió esperar un momento (límite por minuto).";
  if (status >= 500) return "Voyage tuvo un error. Se reintentará más tarde.";
  return msg ? `Voyage: ${msg}` : `Voyage respondió ${status}`;
}

/**
 * Pide embeddings. inputType: "query" (lo que escribe el usuario) o "document" (neuronas).
 * @returns {Promise<{ vectors: number[][], tokens: number }>}
 */
export async function embedTexts(texts, { inputType = "document", timeoutMs = 15000, apiKey = getVoyageKey() } = {}) {
  if (!apiKey) throw new VoyageError("Falta la clave de Voyage.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(VOYAGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: inputType, output_dimension: VOYAGE_DIM }),
      signal: controller.signal,
    });
    if (!res.ok) {
      let msg = "";
      try { msg = (await res.json())?.detail || ""; } catch (_e) { /* sin cuerpo */ }
      throw new VoyageError(friendly(res.status, String(msg).slice(0, 160)), res.status);
    }
    const data = await res.json();
    const vectors = (data?.data || []).sort((a, b) => a.index - b.index).map((d) => d.embedding);
    if (vectors.length !== texts.length) throw new VoyageError("Voyage devolvió una respuesta incompleta.");
    return { vectors, tokens: Number(data?.usage?.total_tokens) || 0 };
  } catch (err) {
    if (err instanceof VoyageError) throw err;
    if (err?.name === "AbortError") throw new VoyageError("Voyage tardó demasiado.");
    throw new VoyageError("No se pudo conectar con Voyage.");
  } finally {
    clearTimeout(timer);
  }
}
