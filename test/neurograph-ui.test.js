import test from "node:test";
import assert from "node:assert/strict";

import { createNeuron } from "../src/neuro/schemas.js";
import { buildNeuronGraph } from "../src/neuro/graph.js";
import { viewNeuroGraph } from "../src/chat/neurograph-ui.js";

test("graph nodes exponen evolution para UI", () => {
  const neuron = createNeuron({
    id: "ng_evo_1",
    core: { concept: "terapia", domain: "health", summary: "sesiones" },
    triggers: ["terapia"],
    evolution: { usageCount: 3, successfulActivations: 2, failedActivations: 1 },
  });
  const graph = buildNeuronGraph([neuron]);
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].evolution.usageCount, 3);
});

test("neurograph UI expone controles de borrado seguro", () => {
  const html = viewNeuroGraph();
  assert.match(html, /show deleted/i);
  assert.match(html, /Haz clic en una neurona para ver su detalle/i);
});
