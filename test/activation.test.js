import test from "node:test";
import assert from "node:assert/strict";

import { activateNeurons, getActivationTuning } from "../src/neuro/activation.js";
import { getBootstrapState } from "../src/neuro/bootstrap.js";
import { createNeuron } from "../src/neuro/schemas.js";

test("activation threshold lowers with few neurons", () => {
  const strong = getActivationTuning(4, { bootstrapState: getBootstrapState(4) });
  const normal = getActivationTuning(10, { bootstrapState: getBootstrapState(10) });
  const off = getActivationTuning(20, { bootstrapState: getBootstrapState(20) });

  assert.ok(strong.minScore < normal.minScore);
  assert.ok(normal.minScore < off.minScore);
});

test("bootstrap tuning increases keyword weight and relaxes semantic weight", () => {
  const strong = getActivationTuning(4, { bootstrapState: getBootstrapState(4) });
  const off = getActivationTuning(25, { bootstrapState: getBootstrapState(25) });

  assert.ok(strong.weights.keyword > off.weights.keyword);
  assert.ok(strong.weights.semantic < off.weights.semantic);
  assert.equal(strong.bootstrapAdjusted, true);
});

test("activation prioriza presente cuando input habla del presente", async () => {
  const neurons = [
    createNeuron({
      id: "n_recent",
      core: { concept: "ansiedad en trabajo", domain: "work", summary: "hoy ansiedad" },
      triggers: ["ansiedad", "trabajo"],
      temporal: { date: "2026-03-18", timeContext: "current" },
      weight: 0.6,
    }),
    createNeuron({
      id: "n_hist",
      core: { concept: "ansiedad en trabajo", domain: "work", summary: "antes ansiedad" },
      triggers: ["ansiedad", "trabajo"],
      temporal: { date: "2025-01-01", timeContext: "historical" },
      weight: 0.6,
    }),
  ];
  const out = await activateNeurons("hoy me pasa ansiedad en el trabajo", neurons, { persistActivation: false, minScore: 0 });
  assert.equal(out[0].neuron.id, "n_recent");
});

test("activation prioriza histórico cuando input habla del pasado", async () => {
  const neurons = [
    createNeuron({
      id: "n_recent",
      core: { concept: "ansiedad en trabajo", domain: "work", summary: "actual" },
      triggers: ["ansiedad", "trabajo"],
      temporal: { date: "2026-03-18", timeContext: "current" },
      weight: 0.6,
    }),
    createNeuron({
      id: "n_hist",
      core: { concept: "ansiedad en trabajo", domain: "work", summary: "cuando era niño" },
      triggers: ["ansiedad", "trabajo"],
      temporal: { date: "2024-01-01", timeContext: "historical", stage: "infancia" },
      weight: 0.6,
    }),
  ];
  const out = await activateNeurons("antes me pasaba ansiedad cuando era niño", neurons, { persistActivation: false, minScore: 0 });
  assert.equal(out[0].neuron.id, "n_hist");
});
