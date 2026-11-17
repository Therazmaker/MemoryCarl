/**
 * claudeModels.js — Modelos de Claude y cómo llamarlos
 * MemoryCarl
 *
 * Los modelos 5.x piensan antes de responder (no se puede apagar): la respuesta trae primero
 * un bloque de pensamiento y después el texto, y necesitan más tokens y más tiempo.
 */

export const CLAUDE_MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5 (Recomendado: el más consistente)" },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5 (Muy bueno, la mitad de precio)" },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (Rápido y barato, se confunde más)" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5 (Anterior)" },
];

/** Modelo para una instalación nueva, sin modelo elegido. */
export const DEFAULT_CLAUDE_MODEL = "claude-opus-5-5";

export function isThinkingClaudeModel(model = "") {
  return /^claude-(opus|sonnet|haiku|fable|mythos)-5/.test(String(model || ""));
}

/**
 * Parámetros de la llamada según el modelo.
 * @param {string} model
 * @param {{ maxTokens?: number, effort?: "low"|"medium"|"high" }} [opts]
 * @returns {{ body: object, timeoutMs: number }}
 */
export function claudeCallParams(model, opts = {}) {
  if (!isThinkingClaudeModel(model)) return { body: { max_tokens: opts.maxTokens || 2048 }, timeoutMs: 30_000 };
  return {
    body: { max_tokens: Math.max(opts.maxTokens || 2048, 16_000), ...(opts.effort ? { output_config: { effort: opts.effort } } : {}) },
    timeoutMs: 120_000,
  };
}

/** Texto de la respuesta (los modelos que piensan mandan antes un bloque de pensamiento). */
export function claudeReplyText(data) {
  return (Array.isArray(data?.content) ? data.content : []).filter((b) => b?.type === "text" || (!b?.type && typeof b?.text === "string")).map((b) => b.text || "").join("\n").trim();
}

