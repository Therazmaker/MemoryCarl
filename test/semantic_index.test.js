import test from "node:test";
import assert from "node:assert/strict";

import {
  neuronEmbeddingText, textHash, pendingNeurons, makeBatches, semanticSignals, pruneIndex, indexNeurons, loadSemanticIndex, SEMANTIC_KEY,
} from "../src/neuro/semanticIndex.js";
import { buildRelevanceScorer } from "../src/neuro/relevance.js";

const N = (id, concept, summary = "", triggers = []) => ({ id, core: { concept, summary }, triggers, connections: [] });

function memStorage() {
  const store = {};
  globalThis.localStorage = { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
  return store;
}

test("pendientes: sin vector, texto cambiado o modelo distinto", () => {
  const a = N("a", "Agotamiento", "sin energía");
  const b = N("b", "Presupuesto", "gastos");
  const index = { model: "m1", items: { a: { h: textHash(neuronEmbeddingText(a)), v: [1] } } };
  assert.deepEqual(pendingNeurons([a, b], index, "m1").map((n) => n.id), ["b"]);
  assert.deepEqual(pendingNeurons([{ ...a, core: { ...a.core, summary: "otro" } }], index, "m1").map((n) => n.id), ["a"]);
  assert.equal(pendingNeurons([a, b], index, "m2").length, 2);
  assert.deepEqual(Object.keys(pruneIndex(index, [b]).items), []);
});

test("tandas respetan el límite de tokens", () => {
  const many = Array.from({ length: 50 }, (_, i) => N(`n${i}`, "x".repeat(600)));
  const batches = makeBatches(many, 1000);
  assert.ok(batches.length > 1);
  assert.equal(batches.flat().length, 50);
});

test("señal de significado: solo lo que sobresale del promedio", () => {
  const index = { items: { a: { v: [1, 0, 0] }, b: { v: [0, 1, 0] }, c: { v: [0, 0, 1] }, d: { v: [0.7, 0.7, 0] } } };
  const sig = semanticSignals([1, 0, 0], index);
  assert.equal(sig.get("a"), 1);
  assert.ok(sig.get("d") > 0, "la parecida también sobresale");
  assert.ok(!sig.has("b") && !sig.has("c"));
  // consulta que no se parece a nada en particular: nada sobresale
  const flat = semanticSignals([0.577, 0.577, 0.577], { items: { a: { v: [1, 0, 0] }, b: { v: [0, 1, 0] }, c: { v: [0, 0, 1] } } });
  assert.equal(flat.size, 0);
});

test("la señal de significado activa una neurona sin palabras en común", () => {
  const score = buildRelevanceScorer([N("a", "Agotamiento físico", "sin energía", ["agotamiento"]), N("b", "Presupuesto", "gastos", ["gastos"])]);
  assert.equal(score("estoy hecho polvo").size, 0, "sin significado no hay coincidencia");
  const r = score("estoy hecho polvo", { semantic: new Map([["a", 0.8]]) });
  assert.ok(r.get("a").relevance >= 0.6 && r.get("a").semantic === 0.8);
});

test("indexar: guarda vectores, solo pide lo pendiente y pausa entre tandas", async () => {
  memStorage();
  const neurons = [N("a", "Uno"), N("b", "Dos"), N("c", "Tres")];
  const calls = [];
  const embed = async (texts) => { calls.push(texts.length); return { vectors: texts.map((_, i) => [i, 1]) }; };
  const sleeps = [];
  const r = await indexNeurons({ neurons, embed, model: "m", sleep: async (ms) => { sleeps.push(ms); } });
  assert.equal(r.indexed, 3);
  assert.equal(Object.keys(loadSemanticIndex().items).length, 3);
  assert.equal(JSON.parse(globalThis.localStorage.getItem(SEMANTIC_KEY)).model, "m");
  const again = await indexNeurons({ neurons, embed, model: "m", sleep: async () => {} });
  assert.equal(again.indexed, 0, "nada pendiente: no llama a Voyage");
  assert.deepEqual(calls, [3]);
  assert.equal(sleeps.length, 0);
});
