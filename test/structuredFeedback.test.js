import test from "node:test";
import assert from "node:assert/strict";

import {
  recordResponseFeedback, getResponseFeedbackHistory,
  getReplySourceStats, separateNeurons,
  generateRelationSuggestions, confirmRelation,
  getPendingRelationSuggestions,
} from "../src/neuro/structuredFeedback.js";
import { upsertRelation } from "../src/neuro/relationStore.js";

function resetStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
  localStorage.clear();
}

test("recordResponseFeedback guarda y recupera", () => {
  resetStorage();
  recordResponseFeedback({ messageId: "m1", rating: "useful", replySource: "local_engine", activatedIds: ["n1"] });
  const history = getResponseFeedbackHistory();
  assert.equal(history.length, 1);
  assert.equal(history[0].rating, "useful");
});

test("recordResponseFeedback lanza con rating inválido", () => {
  resetStorage();
  assert.throws(() => recordResponseFeedback({ messageId: "m2", rating: "amazing" }));
});

test("getReplySourceStats calcula score correctamente", () => {
  resetStorage();
  recordResponseFeedback({ messageId: "m1", rating: "useful", replySource: "local_engine" });
  recordResponseFeedback({ messageId: "m2", rating: "useless", replySource: "local_engine" });
  const stats = getReplySourceStats();
  assert.equal(stats.local_engine.score, 0.5);
  assert.equal(stats.local_engine.total, 2);
});

test("separateNeurons crea relación contradice", () => {
  resetStorage();
  const rel = separateNeurons({ neuronAId: "n1", neuronBId: "n2", messageId: "m1" });
  assert.equal(rel.type, "contradice");
  assert.equal(rel.origin, "feedback");
});

test("generateRelationSuggestions retorna máximo 3 sugerencias", () => {
  resetStorage();
  const activated = Array.from({ length: 5 }, (_, i) => ({
    neuron: { id: `n${i}`, type: "pattern", emotion: "sadness", core: { domain: "work" }, triggers: [] },
  }));
  const suggestions = generateRelationSuggestions({ messageId: "m3", activated });
  assert.ok(suggestions.length <= 3);
});

test("generateRelationSuggestions no duplica relaciones existentes", () => {
  resetStorage();
  upsertRelation({ sourceId: "n1", targetId: "n2", type: "refuerza", strength: 0.7 });
  const activated = [
    { neuron: { id: "n1", type: "pattern", emotion: "sadness", core: { domain: "work" }, triggers: [] } },
    { neuron: { id: "n2", type: "pattern", emotion: "sadness", core: { domain: "work" }, triggers: [] } },
  ];
  const suggestions = generateRelationSuggestions({ messageId: "m4", activated });
  assert.equal(suggestions.some((s) => s.sourceId === "n1" && s.targetId === "n2" && s.type === "refuerza"), false);
});

test("confirmRelation marca sugerencia como confirmed", () => {
  resetStorage();
  const activated = [
    { neuron: { id: "n1", type: "pattern", emotion: "sadness", core: { domain: "work" }, triggers: [] } },
    { neuron: { id: "n2", type: "pattern", emotion: "sadness", core: { domain: "work" }, triggers: [] } },
  ];
  const suggestions = generateRelationSuggestions({ messageId: "m5", activated });
  assert.ok(suggestions.length > 0);
  confirmRelation({ suggestionId: suggestions[0].id, messageId: "m5" });
  const pending = getPendingRelationSuggestions("m5");
  assert.equal(pending.find((s) => s.id === suggestions[0].id), undefined);
});

test("getResponseFeedbackHistory filtra por replySource", () => {
  resetStorage();
  recordResponseFeedback({ messageId: "m1", rating: "useful", replySource: "local_engine" });
  recordResponseFeedback({ messageId: "m2", rating: "useless", replySource: "gemini" });
  const localOnly = getResponseFeedbackHistory({ replySource: "local_engine" });
  assert.equal(localOnly.length, 1);
  assert.equal(localOnly[0].replySource, "local_engine");
});
