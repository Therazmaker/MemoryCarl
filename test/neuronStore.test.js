import test from "node:test";
import assert from "node:assert/strict";

const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem: (k) => store[k] ?? null,
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}
function resetStorage() { Object.keys(store).forEach((k) => delete store[k]); }

import { createNeuron } from "../src/neuro/schemas.js";
import { saveManyNeurons, getNeuronDeletionImpact, deleteNeuronSafely, getAllNeurons } from "../src/neuro/neuronStore.js";

function seed() {
  const a = createNeuron({ id: "nA", core: { concept: "A", domain: "work", summary: "" }, connections: ["nB"] });
  const b = createNeuron({ id: "nB", core: { concept: "B", domain: "work", summary: "" }, connections: ["nA"] });
  saveManyNeurons([a, b]);
  localStorage.setItem("memorycarl_memories_v1", JSON.stringify([{ id: "m1", text: "x", linkedNeurons: ["nA", "nB"] }]));
  localStorage.setItem("memorycarl_neurochat_insight_history", JSON.stringify([{ id: "i1", basedOnNeurons: ["nA"] }]));
}

test("getNeuronDeletionImpact calcula conexiones/memorias/insights", () => {
  resetStorage();
  seed();
  const impact = getNeuronDeletionImpact("nA");
  assert.equal(impact.connectionsAffected, 1);
  assert.equal(impact.memoriesAffected, 1);
  assert.equal(impact.insightsAffected, 1);
});

test("deleteNeuronSafely limpia referencias cruzadas", () => {
  resetStorage();
  seed();
  const result = deleteNeuronSafely("nA", { hard: true });
  assert.equal(result.ok, true);
  assert.equal(getAllNeurons({ includeDeleted: true }).some((n) => n.id === "nA"), false);
  const memories = JSON.parse(localStorage.getItem("memorycarl_memories_v1") || "[]");
  assert.deepEqual(memories[0].linkedNeurons, ["nB"]);
  const insights = JSON.parse(localStorage.getItem("memorycarl_neurochat_insight_history") || "[]");
  assert.deepEqual(insights[0].basedOnNeurons, []);
});
