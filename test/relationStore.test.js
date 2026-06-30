import test from "node:test";
import assert from "node:assert/strict";

import {
  upsertRelation, getAllRelations, getRelationsForNeuron,
  rejectRelation, inferRelationsFromActivation, getStrongestRelations,
  RELATION_TYPES,
} from "../src/neuro/relationStore.js";

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

test("upsertRelation crea relación válida", () => {
  resetStorage();
  const r = upsertRelation({ sourceId: "a", targetId: "b", type: "causa" });
  assert.equal(r.sourceId, "a");
  assert.equal(r.targetId, "b");
  assert.equal(r.type, "causa");
  assert.ok(r.strength > 0);
});

test("upsertRelation lanza error si tipo inválido", () => {
  resetStorage();
  assert.throws(() => upsertRelation({ sourceId: "a", targetId: "b", type: "INVENTADO" }));
});

test("upsertRelation en relación existente incrementa strength", () => {
  resetStorage();
  upsertRelation({ sourceId: "a", targetId: "b", type: "causa", strength: 0.5 });
  const r2 = upsertRelation({ sourceId: "a", targetId: "b", type: "causa", strength: 0.5 });
  assert.ok(r2.strength > 0.5);
  assert.equal(r2.confirmations, 1);
});

test("getRelationsForNeuron retorna salientes y entrantes", () => {
  resetStorage();
  upsertRelation({ sourceId: "x", targetId: "y", type: "refuerza" });
  upsertRelation({ sourceId: "z", targetId: "x", type: "causa" });
  const rels = getRelationsForNeuron("x");
  assert.equal(rels.length, 2);
});

test("rejectRelation elimina relación inferida", () => {
  resetStorage();
  const r = upsertRelation({ sourceId: "a", targetId: "b", type: "refuerza", origin: "inferred" });
  const result = rejectRelation(r.id);
  assert.equal(result, "deleted");
  assert.equal(getAllRelations().find((x) => x.id === r.id), undefined);
});

test("RELATION_TYPES tiene 7 tipos", () => {
  assert.equal(RELATION_TYPES.length, 7);
});

test("inferRelationsFromActivation detecta emociones compartidas", () => {
  resetStorage();
  const activated = [
    { neuron: { id: "n1", type: "pattern", emotion: "sadness", core: { domain: "work" }, triggers: [] } },
    { neuron: { id: "n2", type: "pattern", emotion: "sadness", core: { domain: "work" }, triggers: [] } },
  ];
  const suggestions = inferRelationsFromActivation(activated);
  assert.ok(suggestions.length > 0);
  assert.equal(suggestions[0].type, "refuerza");
});

test("inferRelationsFromActivation no lanza con activated vacío", () => {
  resetStorage();
  assert.doesNotThrow(() => inferRelationsFromActivation([]));
  assert.deepEqual(inferRelationsFromActivation([]), []);
});

test("getStrongestRelations retorna las más fuertes primero", () => {
  resetStorage();
  upsertRelation({ sourceId: "n1", targetId: "n2", type: "causa", strength: 0.3 });
  upsertRelation({ sourceId: "n1", targetId: "n3", type: "refuerza", strength: 0.9 });
  const strongest = getStrongestRelations("n1", 5);
  assert.ok(strongest[0].relation.strength >= (strongest[1]?.relation.strength ?? 0));
});
