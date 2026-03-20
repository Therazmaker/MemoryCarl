/**
 * sessionMemory.js — Memoria episódica de sesiones de conversación
 * NeuroChat / MemoryCarl
 *
 * Exporta:
 *   buildSessionSummary(params)  → objeto de resumen
 *   saveSessionMemory(summary)   → Neuron guardada
 *   getRecentSessions(n)         → últimas N sesiones
 */

import { saveNeuron } from "./neuronStore.js";
import { createNeuron } from "./schemas.js";
import { uuid4 } from "./utils.js";

const SESSION_INDEX_KEY = "memorycarl_session_index";
const MAX_SESSIONS = 100;

/**
 * Construye un resumen de sesión a partir del historial y los resultados del turno.
 *
 * @param {{
 *   history: Array<{role, content, ts}>,
 *   dominantActivated: Array<{neuron, score}>,
 *   insights: Array<object>,
 *   replyModes: Array<string>,
 *   relationHintsApplied: number,
 *   triggersApplied: number,
 * }} params
 * @returns {object|null} sessionSummary
 */
export function buildSessionSummary({
  history = [],
  dominantActivated = [],
  insights = [],
  replyModes = [],
  relationHintsApplied = 0,
  triggersApplied = 0,
} = {}) {
  const userMessages = history.filter((m) => m.role === "user");
  const assistantMessages = history.filter((m) => m.role === "assistant");
  if (userMessages.length === 0) return null;

  const conceptCounts = {};
  for (const { neuron } of dominantActivated) {
    const concept = neuron?.core?.concept;
    if (concept) conceptCounts[concept] = (conceptCounts[concept] || 0) + 1;
  }
  const dominantConcept = Object.entries(conceptCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "general";

  const domainCounts = {};
  for (const { neuron } of dominantActivated) {
    const domain = neuron?.core?.domain || "general";
    domainCounts[domain] = (domainCounts[domain] || 0) + 1;
  }
  const dominantDomain = Object.entries(domainCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "general";

  const modeCounts = {};
  for (const m of replyModes) modeCounts[m] = (modeCounts[m] || 0) + 1;
  const dominantMode = Object.entries(modeCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || "autonomous";

  const firstUserMessage = userMessages[0]?.content?.slice(0, 100) || "";
  const lastUserMessage = userMessages[userMessages.length - 1]?.content?.slice(0, 100) || "";
  const insightSummaries = insights.slice(0, 2).map((i) => i.summary).filter(Boolean);

  const summary = [
    `Sesión de ${userMessages.length} turnos sobre "${dominantConcept}" (${dominantDomain}).`,
    firstUserMessage !== lastUserMessage
      ? `Empezó con "${firstUserMessage}" y terminó con "${lastUserMessage}".`
      : `Tema central: "${firstUserMessage}".`,
    insightSummaries.length > 0 ? insightSummaries.join(" ") : "",
    relationHintsApplied > 0 ? `Se establecieron ${relationHintsApplied} relaciones nuevas.` : "",
    triggersApplied > 0 ? `Se aprendieron ${triggersApplied} nuevos triggers.` : "",
  ].filter(Boolean).join(" ");

  return {
    id: uuid4(),
    ts: Date.now(),
    turnCount: userMessages.length,
    dominantConcept,
    dominantDomain,
    dominantMode,
    insightSummaries,
    relationHintsApplied,
    triggersApplied,
    summary,
    openQuestion: extractOpenQuestion(assistantMessages),
  };
}

/**
 * Guarda un resumen de sesión como neurona de tipo session_memory.
 * @param {object} sessionSummary — resultado de buildSessionSummary
 * @returns {object|null} neurona guardada
 */
export function saveSessionMemory(sessionSummary) {
  if (!sessionSummary?.summary) return null;

  const neuron = createNeuron({
    type: "memory",
    core: {
      concept: `Sesión: ${sessionSummary.dominantConcept}`,
      domain: sessionSummary.dominantDomain || "general",
      summary: sessionSummary.summary,
    },
    triggers: [
      sessionSummary.dominantConcept,
      sessionSummary.dominantDomain,
      "sesión",
      "conversación",
    ].filter(Boolean),
    emotion: "neutral",
    source: { kind: "generated", ref: "session_memory" },
    temporal: {
      timestamp: new Date().toISOString(),
      timeContext: "current",
    },
    meta: {
      notes: sessionSummary.openQuestion || "",
      manualCategory: "other",
    },
  });

  const saved = saveNeuron(neuron);

  try {
    const index = readSessionIndex();
    index.push({
      neuronId: saved?.id || null,
      ts: sessionSummary.ts,
      dominantConcept: sessionSummary.dominantConcept,
      turnCount: sessionSummary.turnCount,
    });
    writeSessionIndex(index);
  } catch (_e) {
    // noop
  }

  return saved;
}

/**
 * Devuelve las últimas N sesiones guardadas (índice, no las neuronas completas).
 * @param {number} [n=10]
 * @returns {Array}
 */
export function getRecentSessions(n = 10) {
  return readSessionIndex()
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, n);
}

// ---- Helpers internos ----

function extractOpenQuestion(assistantMessages) {
  for (let i = assistantMessages.length - 1; i >= 0; i--) {
    const content = assistantMessages[i]?.content || "";
    const match = content.match(/[^.!]*\?/);
    if (match) return match[0].trim().slice(0, 200);
  }
  return "";
}

function readSessionIndex() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(SESSION_INDEX_KEY);
    return JSON.parse(raw || "[]") || [];
  } catch (_e) {
    return [];
  }
}

function writeSessionIndex(index) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(SESSION_INDEX_KEY, JSON.stringify(index.slice(-MAX_SESSIONS)));
  } catch (_e) {
    // noop
  }
}
