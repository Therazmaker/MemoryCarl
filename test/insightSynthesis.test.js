import test from "node:test";
import assert from "node:assert/strict";

import { synthesizeInsights, compressInsights, rankInsights } from "../src/neuro/insightSynthesis.js";

test("compressInsights comprime insights casi iguales", () => {
  const insights = [
    { id: "i1", type: "dominant_pattern", title: "A", summary: "a", confidence: 0.8, basedOnNeurons: ["1", "2"], signals: { dominantConcepts: ["x"] } },
    { id: "i2", type: "dominant_pattern", title: "B", summary: "b", confidence: 0.7, basedOnNeurons: ["1", "2", "3"], signals: { dominantConcepts: ["y"] } },
  ];
  const out = compressInsights(insights);
  assert.equal(out.length, 1);
});

test("synthesizeInsights genera entre 1 y 3 insights válidos", () => {
  const out = synthesizeInsights({
    activated: [{ neuron: { id: "n1", core: { domain: "work" } } }],
    clusters: [{ id: "c1", domains: ["work"], emotion: "fear", neuronIds: ["n1"], dominantConcepts: ["urgencia"], weight: 0.8, manualEntities: [] }],
    patterns: [{ type: "dominant_pattern", confidence: 0.8, clusterId: "c1", formula: "A->B", description: "Sobrecarga y bloqueo", basedOnNeurons: ["n1"], domains: ["work"] }],
    options: { maxInsights: 3 },
  });
  assert.ok(out.length >= 1 && out.length <= 3);
  assert.equal(typeof out[0].summary, "string");
});

test("objective mode prioriza dominant/contradiction en ranking", () => {
  const ranked = rankInsights([
    { id: "a", type: "anchor", confidence: 0.8, basedOnNeurons: ["1"], signals: {} },
    { id: "b", type: "dominant_pattern", confidence: 0.75, basedOnNeurons: ["1", "2"], signals: {} },
  ], { interpretationMode: "objective" });
  assert.equal(ranked[0].type, "dominant_pattern");
});
