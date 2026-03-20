import test from "node:test";
import assert from "node:assert/strict";

import { traceChain, findContradictions, buildReasoningContext } from "../src/neuro/graphReasoner.js";
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

test("traceChain sigue cadena causa→causa", () => {
  resetStorage();
  upsertRelation({ sourceId: "a", targetId: "b", type: "causa", strength: 0.8 });
  upsertRelation({ sourceId: "b", targetId: "c", type: "causa", strength: 0.7 });
  const chains = traceChain(["a"]);
  assert.ok(chains.length > 0);
  const longChain = chains.find((c) => c.path.includes("c"));
  assert.ok(longChain);
});

test("traceChain no crea ciclos infinitos", () => {
  resetStorage();
  upsertRelation({ sourceId: "a", targetId: "b", type: "causa", strength: 0.8 });
  upsertRelation({ sourceId: "b", targetId: "a", type: "causa", strength: 0.8 });
  assert.doesNotThrow(() => traceChain(["a"]));
});

test("traceChain respeta maxDepth", () => {
  resetStorage();
  upsertRelation({ sourceId: "a", targetId: "b", type: "causa", strength: 0.9 });
  upsertRelation({ sourceId: "b", targetId: "c", type: "causa", strength: 0.9 });
  upsertRelation({ sourceId: "c", targetId: "d", type: "causa", strength: 0.9 });
  const chains = traceChain(["a"], { maxDepth: 3, minStrength: 0.1 });
  assert.equal(chains.every((c) => c.path.length <= 3), true);
});

test("findContradictions detecta par contradictorio", () => {
  resetStorage();
  upsertRelation({ sourceId: "n1", targetId: "n2", type: "contradice", strength: 0.7 });
  const n1 = { id: "n1", core: { concept: "orden" } };
  const n2 = { id: "n2", core: { concept: "caos" } };
  const activated = [{ neuron: n1 }, { neuron: n2 }];
  const result = findContradictions(activated);
  assert.equal(result.length, 1);
  assert.equal(result[0].a.id, "n1");
  assert.equal(result[0].b.id, "n2");
});

test("buildReasoningContext no lanza con activated vacío", () => {
  resetStorage();
  assert.doesNotThrow(() => buildReasoningContext([]));
  const ctx = buildReasoningContext([]);
  assert.deepEqual(ctx.chains, []);
  assert.equal(ctx.graphSummary, "");
});

test("buildReasoningContext genera graphSummary con cadena existente", () => {
  resetStorage();
  upsertRelation({ sourceId: "x", targetId: "y", type: "causa", strength: 0.8 });
  const allNeurons = [
    { id: "x", core: { concept: "estrés" } },
    { id: "y", core: { concept: "insomnio" } },
  ];
  const activated = [{ neuron: allNeurons[0], score: 0.9 }];
  const ctx = buildReasoningContext(activated, allNeurons);
  assert.ok(ctx.graphSummary.length > 0);
});
