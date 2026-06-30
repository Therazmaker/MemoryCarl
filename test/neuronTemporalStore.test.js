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
function reset() { Object.keys(store).forEach((k) => delete store[k]); }

import { createNeuron } from "../src/neuro/schemas.js";
import { saveNeuron, getAllNeurons, updateNeuronTemporal } from "../src/neuro/neuronStore.js";

test("updateNeuronTemporal permite editar date/stage/isHistorical", () => {
  reset();
  const neuron = createNeuron({
    id: "temp_n1",
    core: { concept: "recuerdo", domain: "personal", summary: "algo" },
  });
  saveNeuron(neuron);
  const out = updateNeuronTemporal("temp_n1", { date: "2017-03-21", stage: "juventud", isHistorical: true });
  assert.equal(out.temporal.date, "2017-03-21");
  assert.equal(out.temporal.stage, "juventud");
  assert.equal(out.temporal.isHistorical, true);
});

test("migración asigna temporal fallback cuando falta", () => {
  reset();
  localStorage.setItem("memorycarl_neurochat_neurons", JSON.stringify([
    {
      id: "legacy_1",
      type: "memory",
      core: { concept: "legacy", domain: "general", summary: "" },
      triggers: [],
      connections: [],
      weight: 0.5,
      emotion: "neutral",
      evidence: [],
      embedding: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      source: { kind: "user", ref: "" },
      feedbackStats: { likes: 0, dislikes: 0, netScore: 0, lastFeedbackAt: null },
      activationLearning: { usefulCount: 0, falsePositiveCount: 0 },
      evolution: { usageCount: 0, successfulActivations: 0, failedActivations: 0, triggerHistory: [], weightHistory: [] },
    },
  ]));
  const all = getAllNeurons();
  assert.equal(all[0].temporal.isHistorical, false);
  assert.equal(all[0].temporal.date, null);
  assert.equal(all[0].temporal.stage, null);
  assert.equal(all[0].temporal.source, "unknown");
});
