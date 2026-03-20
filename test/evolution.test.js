import test from "node:test";
import assert from "node:assert/strict";

import { createNeuron } from "../src/neuro/schemas.js";
import {
  ensureNeuronEvolution,
  recordNeuronUsage,
  recordSuccessfulActivation,
  recordFailedActivation,
  appendTriggerCandidate,
  rejectTriggerCandidate,
  acceptTriggerCandidate,
  getApprovedTriggerCandidates,
  pruneWeakTriggers,
  detectWeakSummary,
  suggestConnectionEvolution,
  evolveNeuron,
} from "../src/neuro/evolution.js";

test("recordNeuronUsage incrementa usageCount", () => {
  const neuron = createNeuron({ id: "evo_1", core: { concept: "terapia", domain: "health", summary: "" } });
  recordNeuronUsage(neuron, { inputPreview: "sesión con psicólogo", score: 0.7 });
  assert.equal(neuron.evolution.usageCount, 1);
  assert.ok(neuron.evolution.lastUsedAt);
});

test("successfulActivations y failedActivations se registran", () => {
  const neuron = createNeuron({ id: "evo_2", core: { concept: "terapia", domain: "health", summary: "" } });
  recordSuccessfulActivation(neuron, { inputPreview: "sesión útil" });
  recordFailedActivation(neuron, { inputPreview: "ruido", falsePositive: true });
  assert.equal(neuron.evolution.successfulActivations, 1);
  assert.equal(neuron.evolution.failedActivations, 1);
  assert.equal(neuron.evolution.falsePositiveCount, 1);
});

test("trigger candidate útil se acumula y se aprueba por umbral", () => {
  const neuron = createNeuron({ id: "evo_3", core: { concept: "terapia psicológica", domain: "health", summary: "psicólogo y acompañamiento" }, triggers: ["terapia"] });
  appendTriggerCandidate(neuron, { trigger: "psicólogo", score: 0.72, inputPreview: "mi psicólogo" });
  appendTriggerCandidate(neuron, { trigger: "psicólogo", score: 0.77, inputPreview: "otra sesión con psicólogo" });
  const approved = getApprovedTriggerCandidates(neuron);
  assert.equal(approved.length, 1);
  acceptTriggerCandidate(neuron, "psicólogo", "repeated useful match");
  assert.ok(neuron.triggers.includes("psicólogo"));
});

test("trigger candidato genérico se rechaza", () => {
  const neuron = createNeuron({ id: "evo_4", core: { concept: "algo", domain: "general", summary: "" } });
  const res = appendTriggerCandidate(neuron, { trigger: "yo", score: 0.9 });
  assert.equal(res.added, false);
  appendTriggerCandidate(neuron, { trigger: "terapia", score: 0.6 });
  const rejected = rejectTriggerCandidate(neuron, "terapia", "manual rejection");
  assert.equal(rejected.rejected, true);
});

test("pruneWeakTriggers elimina triggers débiles", () => {
  const neuron = createNeuron({ id: "evo_5", core: { concept: "laboral", domain: "work", summary: "" }, triggers: ["la", "trabajo"] });
  ensureNeuronEvolution(neuron);
  neuron.evolution.usageCount = 10;
  neuron.evolution.successfulActivations = 1;
  const out = pruneWeakTriggers(neuron);
  assert.ok(out.pruned >= 1);
});

test("detectWeakSummary y suggestConnectionEvolution funcionan", () => {
  const neuron = createNeuron({ id: "evo_6", core: { concept: "terapia", domain: "health", summary: "general" } });
  const weak = detectWeakSummary(neuron);
  assert.equal(weak.weak, true);

  const suggestions = suggestConnectionEvolution(neuron, [{ id: "n2" }, { id: "n2" }, { id: "n3" }], { minCoActivation: 2 });
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].targetId, "n2");
});

test("evolveNeuron ajusta weight y deja history trazable", () => {
  const neuron = createNeuron({ id: "evo_7", core: { concept: "foco", domain: "work", summary: "foco con tarea" }, triggers: ["foco"], weight: 0.5 });
  const before = neuron.weight;
  evolveNeuron(neuron, {
    input: "quiero foco y productividad",
    activated: true,
    selected: true,
    feedback: "like",
    score: 0.8,
    coActivatedNeurons: [{ id: "n_other" }, { id: "n_other" }],
  });
  assert.ok(neuron.weight > before);
  assert.ok((neuron.evolution.weightHistory || []).length >= 1);
});
