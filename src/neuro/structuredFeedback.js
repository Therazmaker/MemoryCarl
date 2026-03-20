/**
 * structuredFeedback.js — Feedback estructurado sobre respuestas y relaciones
 */

import { upsertRelation, rejectRelation, getRelationsForNeuron, inferRelationsFromActivation } from "./relationStore.js";
import { uuid4 } from "./utils.js";

const RESPONSE_FEEDBACK_KEY = "memorycarl_response_feedback";
const RELATION_SUGGESTIONS_KEY = "memorycarl_relation_suggestions";
const MAX_RESPONSE_FEEDBACK = 1000;
const MAX_SUGGESTIONS = 500;

export function recordResponseFeedback({ messageId, rating, replySource, activatedIds = [], note = "" }) {
  if (!messageId) throw new Error("messageId requerido");
  if (!["useful", "partial", "useless"].includes(rating)) throw new Error("rating inválido");

  const record = {
    id: uuid4(),
    messageId,
    rating,
    replySource: replySource || "unknown",
    activatedIds: activatedIds.slice(0, 10),
    note: String(note || "").slice(0, 300),
    timestamp: new Date().toISOString(),
  };

  const all = readResponseFeedback();
  all.push(record);
  writeResponseFeedback(all);

  return record;
}

export function getResponseFeedbackHistory(options = {}) {
  let all = readResponseFeedback()
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (options.replySource) all = all.filter((r) => r.replySource === options.replySource);
  if (options.limit) all = all.slice(0, options.limit);
  return all;
}

export function getReplySourceStats() {
  const all = readResponseFeedback();
  const stats = {};

  for (const r of all) {
    const src = r.replySource || "unknown";
    if (!stats[src]) stats[src] = { useful: 0, partial: 0, useless: 0, total: 0, score: 0 };
    stats[src][r.rating] += 1;
    stats[src].total += 1;
  }

  for (const src of Object.keys(stats)) {
    const s = stats[src];
    s.score = s.total > 0
      ? Number(((s.useful * 1 + s.partial * 0.5) / s.total).toFixed(2))
      : 0;
  }

  return stats;
}

export function confirmRelation({ suggestionId, messageId }) {
  const suggestions = readSuggestions();
  const suggestion = suggestions.find((s) => s.id === suggestionId);
  if (!suggestion) throw new Error(`Sugerencia no encontrada: ${suggestionId}`);

  const relation = upsertRelation({
    sourceId: suggestion.sourceId,
    targetId: suggestion.targetId,
    type: suggestion.type,
    strength: Math.min(1, (suggestion.strength || 0.5) + 0.2),
    origin: "feedback",
  });

  const updated = suggestions.map((s) => (
    s.id === suggestionId
      ? { ...s, status: "confirmed", confirmedAt: new Date().toISOString(), messageId, relationId: relation.id }
      : s
  ));
  writeSuggestions(updated);

  return relation;
}

export function rejectInferredRelation({ suggestionId }) {
  const suggestions = readSuggestions();
  const suggestion = suggestions.find((s) => s.id === suggestionId);
  if (!suggestion) return "not_found";

  let result = "not_found";
  if (suggestion.relationId) {
    result = rejectRelation(suggestion.relationId);
  }

  const updated = suggestions.map((s) => (
    s.id === suggestionId ? { ...s, status: "rejected", rejectedAt: new Date().toISOString() } : s
  ));
  writeSuggestions(updated);
  return result;
}

export function createUserRelation({ sourceId, targetId, type, note = null }) {
  return upsertRelation({ sourceId, targetId, type, strength: 0.8, origin: "user", note });
}

export function separateNeurons({ neuronAId, neuronBId, messageId }) {
  return upsertRelation({
    sourceId: neuronAId,
    targetId: neuronBId,
    type: "contradice",
    strength: 0.5,
    origin: "feedback",
    note: `Separadas por usuario en mensaje ${messageId}`,
  });
}

export function generateRelationSuggestions({ messageId, activated }) {
  if (!messageId || !activated?.length) return [];

  const raw = inferRelationsFromActivation(activated);
  if (!raw.length) return [];

  const existing = readSuggestions();
  const newSuggestions = raw
    .filter((s) => {
      const relations = getRelationsForNeuron(s.sourceId);
      return !relations.some((r) => (
        r.type === s.type
        && ((r.sourceId === s.sourceId && r.targetId === s.targetId)
          || (r.sourceId === s.targetId && r.targetId === s.sourceId))
      ));
    })
    .map((s) => ({
      id: uuid4(),
      messageId,
      sourceId: s.sourceId,
      targetId: s.targetId,
      type: s.type,
      strength: s.strength,
      reason: s.reason,
      status: "pending",
      createdAt: new Date().toISOString(),
    }))
    .slice(0, 3);

  if (newSuggestions.length > 0) {
    writeSuggestions([...existing, ...newSuggestions].slice(-MAX_SUGGESTIONS));
  }

  return newSuggestions;
}

export function getPendingRelationSuggestions(messageId) {
  return readSuggestions().filter((s) => s.messageId === messageId && s.status === "pending");
}

function readResponseFeedback() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(RESPONSE_FEEDBACK_KEY);
    return JSON.parse(raw || "[]") || [];
  } catch (_e) {
    return [];
  }
}

function writeResponseFeedback(items) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RESPONSE_FEEDBACK_KEY, JSON.stringify(items.slice(-MAX_RESPONSE_FEEDBACK)));
  } catch (_e) {}
}

function readSuggestions() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(RELATION_SUGGESTIONS_KEY);
    return JSON.parse(raw || "[]") || [];
  } catch (_e) {
    return [];
  }
}

function writeSuggestions(items) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(RELATION_SUGGESTIONS_KEY, JSON.stringify(items.slice(-MAX_SUGGESTIONS)));
  } catch (_e) {}
}
