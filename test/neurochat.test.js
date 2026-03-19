/**
 * neurochat.test.js — Tests para el módulo NeuroChat
 * MemoryCarl
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---- Mock localStorage ----
const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

// ---- Imports ----
import {
  createNeuron, validateNeuron, sanitizeNeuron, generateId, NEURON_TYPES,
} from "../src/neuro/schemas.js";

import {
  getAllNeurons, getNeuronById, saveNeuron, saveManyNeurons,
  updateNeuron, deleteNeuron, searchNeuronsByTrigger, reindexConnections,
} from "../src/neuro/neuronStore.js";

import {
  tokenize, keywordOverlap, clamp, neuronTokenSet, daysSince, truncate,
} from "../src/neuro/utils.js";

import {
  cosineSimilarity,
} from "../src/neuro/embeddings.js";

import {
  normalizeScore, computeRecencyBoost, computeKeywordMatch, computeEmotionMatch,
  activateNeurons,
} from "../src/neuro/activation.js";

import {
  detectMissingConcepts,
} from "../src/neuro/generator.js";

import {
  createTrace, addStep, recordTiming, finalizeTrace,
} from "../src/neuro/trace.js";

// ================================================================
// schemas.js
// ================================================================

test("generateId returns a non-empty string", () => {
  const id = generateId();
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
});

test("generateId produces unique IDs", () => {
  const ids = new Set(Array.from({ length: 20 }, generateId));
  assert.equal(ids.size, 20);
});

test("createNeuron fills defaults", () => {
  const n = createNeuron({});
  assert.ok(NEURON_TYPES.includes(n.type));
  assert.equal(n.type, "memory");
  assert.equal(n.core.domain, "general");
  assert.equal(n.weight, 0.5);
  assert.deepEqual(n.triggers, []);
  assert.deepEqual(n.connections, []);
  assert.equal(n.timesActivated, 0);
  assert.equal(n.lastActivated, null);
});

test("createNeuron preserves provided data", () => {
  const n = createNeuron({
    id: "abc",
    type: "belief",
    core: { concept: "resilience", domain: "psychology", summary: "bounce back" },
    weight: 0.9,
    emotion: "pride",
    triggers: ["resilient", "overcome"],
  });
  assert.equal(n.id, "abc");
  assert.equal(n.type, "belief");
  assert.equal(n.core.concept, "resilience");
  assert.equal(n.weight, 0.9);
  assert.deepEqual(n.triggers, ["resilient", "overcome"]);
});

test("validateNeuron returns errors for corrupt data", () => {
  const errs = validateNeuron(null);
  assert.ok(errs.length > 0);
});

test("validateNeuron passes for valid neuron", () => {
  const n = createNeuron({ core: { concept: "test", domain: "test", summary: "ok" } });
  const errs = validateNeuron(n);
  assert.equal(errs.length, 0);
});

test("sanitizeNeuron clamps weight out of range", () => {
  const n = sanitizeNeuron({ ...createNeuron({}), weight: 5 });
  assert.equal(n.weight, 1);

  const n2 = sanitizeNeuron({ ...createNeuron({}), weight: -3 });
  assert.equal(n2.weight, 0);
});

test("sanitizeNeuron normalizes invalid type to 'memory'", () => {
  const n = sanitizeNeuron({ ...createNeuron({}), type: "alien" });
  assert.equal(n.type, "memory");
});

// ================================================================
// neuronStore.js
// ================================================================

test("neuronStore is empty initially", () => {
  resetStorage();
  assert.deepEqual(getAllNeurons(), []);
});

test("saveNeuron persists and retrieves a neuron", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "focus", domain: "psychology", summary: "concentración" } });
  saveNeuron(n);
  const got = getNeuronById(n.id);
  assert.ok(got);
  assert.equal(got.core.concept, "focus");
});

test("saveNeuron replaces existing neuron by id", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "courage", domain: "values", summary: "ser valiente" } });
  saveNeuron(n);
  saveNeuron({ ...n, core: { ...n.core, summary: "atreverse a actuar" } });
  assert.equal(getAllNeurons().length, 1);
  assert.equal(getNeuronById(n.id).core.summary, "atreverse a actuar");
});

test("saveManyNeurons inserts multiple neurons", () => {
  resetStorage();
  const ns = [
    createNeuron({ core: { concept: "a", domain: "d", summary: "s1" } }),
    createNeuron({ core: { concept: "b", domain: "d", summary: "s2" } }),
    createNeuron({ core: { concept: "c", domain: "d", summary: "s3" } }),
  ];
  const count = saveManyNeurons(ns);
  assert.equal(count, 3);
  assert.equal(getAllNeurons().length, 3);
});

test("updateNeuron patches fields", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "patience", domain: "values", summary: "esperar" } });
  saveNeuron(n);
  const updated = updateNeuron(n.id, { weight: 0.8 });
  assert.ok(updated);
  assert.equal(updated.weight, 0.8);
  assert.equal(updated.core.concept, "patience");
});

test("deleteNeuron removes neuron", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "tmp", domain: "d", summary: "s" } });
  saveNeuron(n);
  assert.equal(getAllNeurons().length, 1);
  const ok = deleteNeuron(n.id);
  assert.equal(ok, true);
  assert.equal(getAllNeurons().length, 0);
});

test("searchNeuronsByTrigger finds by trigger", () => {
  resetStorage();
  const n = createNeuron({ core: { concept: "trust", domain: "relationships", summary: "confianza" }, triggers: ["trust", "confianza", "seguridad"] });
  saveNeuron(n);
  const results = searchNeuronsByTrigger("confianza");
  assert.ok(results.some((r) => r.id === n.id));
});

test("reindexConnections removes orphan connections", () => {
  resetStorage();
  const a = createNeuron({ core: { concept: "A", domain: "d", summary: "s" }, connections: ["non_existent_id"] });
  saveNeuron(a);
  const reindexed = reindexConnections();
  assert.equal(reindexed.find((n) => n.id === a.id).connections.length, 0);
});

// ================================================================
// utils.js
// ================================================================

test("tokenize splits text into lowercase tokens", () => {
  const tokens = tokenize("Hola Mundo! ¿Cómo estás?");
  assert.ok(tokens.includes("hola"));
  assert.ok(tokens.includes("mundo"));
  assert.ok(tokens.every((t) => t === t.toLowerCase()));
});

test("tokenize returns empty array for empty input", () => {
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize(null), []);
});

test("keywordOverlap returns 0 for no overlap", () => {
  assert.equal(keywordOverlap(["cat", "dog"], ["car", "bus"]), 0);
});

test("keywordOverlap returns 1 for full overlap", () => {
  assert.equal(keywordOverlap(["foo", "bar"], ["foo", "bar", "baz"]), 1);
});

test("clamp constrains values", () => {
  assert.equal(clamp(1.5), 1);
  assert.equal(clamp(-0.5), 0);
  assert.equal(clamp(0.7), 0.7);
});

test("daysSince returns Infinity for null", () => {
  assert.equal(daysSince(null), Infinity);
});

test("daysSince returns small value for recent date", () => {
  const recent = new Date(Date.now() - 60000).toISOString(); // 1 min ago
  assert.ok(daysSince(recent) < 0.01);
});

test("truncate shortens long strings", () => {
  const long = "a".repeat(200);
  const out = truncate(long, 50);
  assert.ok(out.length <= 54); // 50 + ellipsis
  assert.ok(out.endsWith("…"));
});

test("neuronTokenSet combines all text fields", () => {
  const n = createNeuron({
    core:     { concept: "resilience", domain: "psychology", summary: "ability to recover" },
    triggers: ["bounce back", "overcome"],
  });
  const s = neuronTokenSet(n);
  assert.ok(s.has("resilience"));
  assert.ok(s.has("ability"));
  assert.ok(s.has("overcome"));
});

// ================================================================
// embeddings.js
// ================================================================

test("cosineSimilarity of identical vectors is 1", () => {
  const v = [0.5, 0.5, 0.5, 0.5];
  assert.ok(Math.abs(cosineSimilarity(v, v) - 1) < 1e-6);
});

test("cosineSimilarity of zero vectors is 0", () => {
  assert.equal(cosineSimilarity([0, 0], [0, 0]), 0);
});

test("cosineSimilarity returns value in [0, 1]", () => {
  const a = [1, 0, -1, 0.5];
  const b = [0, 1,  0.5, -1];
  const sim = cosineSimilarity(a, b);
  assert.ok(sim >= 0 && sim <= 1);
});

// ================================================================
// activation.js
// ================================================================

test("normalizeScore clamps to [0,1]", () => {
  assert.equal(normalizeScore(1.5), 1);
  assert.equal(normalizeScore(-0.2), 0);
  assert.equal(normalizeScore(0.7), 0.7);
});

test("computeRecencyBoost is 1 for today", () => {
  const now = new Date().toISOString();
  assert.equal(computeRecencyBoost(now), 1.0);
});

test("computeRecencyBoost decays over time", () => {
  const ago7  = new Date(Date.now() - 7  * 86400000).toISOString();
  const ago90 = new Date(Date.now() - 90 * 86400000).toISOString();
  const boost7  = computeRecencyBoost(ago7);
  const boost90 = computeRecencyBoost(ago90);
  assert.ok(boost7 > boost90);
});

test("computeKeywordMatch scores partial overlap correctly", () => {
  const n = createNeuron({
    core:     { concept: "consistency", domain: "habits", summary: "daily practice" },
    triggers: ["consistency", "daily", "practice"],
  });
  const queryTokens = ["daily", "practice", "exercise"];
  const score = computeKeywordMatch(queryTokens, n);
  assert.ok(score > 0 && score <= 1);
});

test("computeEmotionMatch returns high score for known match", () => {
  const score = computeEmotionMatch("estoy muy feliz y contento hoy", "joy");
  assert.ok(score > 0.5);
});

test("activateNeurons returns top results for matching input", async () => {
  resetStorage();
  const neurons = [
    createNeuron({ core: { concept: "focus", domain: "productivity", summary: "mantener concentración" }, triggers: ["focus", "concentración", "attention"], weight: 0.8 }),
    createNeuron({ core: { concept: "sleep", domain: "health", summary: "dormir bien" }, triggers: ["sleep", "dormir", "descanso"], weight: 0.6 }),
    createNeuron({ core: { concept: "nutrition", domain: "health", summary: "comer sano" }, triggers: ["comida", "nutrición", "vegetables"], weight: 0.5 }),
  ];
  const activated = await activateNeurons("necesito mejorar mi concentración y focus", neurons, { persistActivation: false });
  assert.ok(activated.length > 0);
  // El primer resultado debe ser el de "focus"
  assert.equal(activated[0].neuron.core.concept, "focus");
  assert.ok(activated[0].score > 0);
});

test("activateNeurons returns empty for empty neuron list", async () => {
  const result = await activateNeurons("hello world", [], { persistActivation: false });
  assert.deepEqual(result, []);
});

// ================================================================
// generator.js
// ================================================================

test("detectMissingConcepts returns low coverage with no neurons", () => {
  const result = detectMissingConcepts("inteligencia artificial y machine learning", []);
  assert.ok(result.coverage === 0);
  assert.ok(result.needsGeneration === true);
  assert.ok(result.reasons.length > 0);
});

test("detectMissingConcepts detects missing tokens", () => {
  const n = createNeuron({ core: { concept: "focus", domain: "productivity", summary: "concentración" }, triggers: ["focus"] });
  const activated = [{ neuron: n, score: 0.8 }];
  const result = detectMissingConcepts("machine learning neural networks deep learning", activated);
  assert.ok(result.missingConcepts.length > 0);
  assert.ok(result.missingConcepts.includes("machine") || result.missingConcepts.includes("learning") || result.missingConcepts.includes("neural") || result.missingConcepts.includes("networks") || result.missingConcepts.includes("deep"));
});

test("detectMissingConcepts is satisfied with good coverage", () => {
  const n = createNeuron({
    core: { concept: "focus", domain: "productivity", summary: "mantener concentración y enfoque" },
    triggers: ["focus", "concentración", "enfoque", "mantener"],
  });
  const activated = Array.from({ length: 4 }, (_, i) => ({ neuron: { ...n, id: `n${i}` }, score: 0.75 }));
  const result = detectMissingConcepts("focus enfoque concentración mantener", activated);
  // Con buena cobertura, needsGeneration debería ser false
  assert.equal(result.needsGeneration, false);
});

// ================================================================
// trace.js
// ================================================================

test("createTrace returns valid trace object", () => {
  const t = createTrace("test_session");
  assert.equal(t.sessionId, "test_session");
  assert.deepEqual(t.steps, []);
  assert.ok(typeof t.startedAt === "number");
});

test("addStep appends steps with elapsed time", () => {
  const t = createTrace();
  addStep(t, "step_one");
  addStep(t, "step_two", { data: 42 });
  assert.equal(t.steps.length, 2);
  assert.equal(t.steps[0].step, "step_one");
  assert.equal(t.steps[1].meta.data, 42);
  assert.ok(typeof t.steps[0].ts === "number");
});

test("recordTiming stores timing entries", () => {
  const t = createTrace();
  recordTiming(t, "activation", 123);
  assert.equal(t.timing.activation, 123);
});

test("finalizeTrace returns complete result", () => {
  const t = createTrace("final_test");
  addStep(t, "load");
  addStep(t, "activate");
  recordTiming(t, "load", 5);
  const result = finalizeTrace(t);
  assert.ok(result.timing.total >= 0);
  assert.equal(result.steps.length, 2);
  assert.equal(result.sessionId, "final_test");
});
