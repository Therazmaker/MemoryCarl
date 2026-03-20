import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeNeuronCoverageQuality,
  suggestNeuronActions,
  buildNeuronSuggestionDraft,
} from "../src/neuro/neuronSuggestions.js";

test("hasSuggestion se activa con low coverage", () => {
  const out = analyzeNeuronCoverageQuality({
    input: "Estoy en terapia psicológica y quiero procesar lo que siento",
    activated: [],
    missingAnalysis: { coverage: 0.22, missingConcepts: ["terapia", "psicológica"] },
    insights: [],
  });
  assert.equal(out.hasSuggestion, true);
  assert.ok(out.reasons.includes("low_coverage"));
});

test("detecta neurona débil por pocos triggers y summary corto", () => {
  const out = analyzeNeuronCoverageQuality({
    input: "Sesión de terapia",
    activated: [{
      score: 0.22,
      neuron: {
        id: "n1",
        core: { concept: "Terapia", summary: "corta" },
        triggers: ["terapia"],
        feedbackStats: { netScore: -3 },
      },
    }],
    missingAnalysis: { coverage: 0.48, missingConcepts: [] },
  });
  assert.equal(out.weakNeurons.length, 1);
  assert.ok(out.weakNeurons[0].flags.includes("few_triggers"));
  assert.ok(out.weakNeurons[0].flags.includes("short_summary"));
});

test("draft sugerido contiene campos requeridos", () => {
  const draft = buildNeuronSuggestionDraft({
    input: "Mi psicólogo me dio una reflexión importante",
    activated: [],
    missingAnalysis: { missingConcepts: ["psicólogo", "reflexión"] },
  });
  assert.ok(draft.conceptHint);
  assert.ok(Array.isArray(draft.triggerHints));
  assert.ok(draft.summaryHint.length > 10);
});

test("suggestNeuronActions incluye crear e improve cuando hay weak neurons", () => {
  const out = suggestNeuronActions({
    input: "Quiero trabajar mejor mi proceso de terapia",
    activated: [{
      score: 0.2,
      neuron: {
        id: "w1",
        core: { concept: "Terapia", summary: "breve" },
        triggers: ["terapia"],
        feedbackStats: { netScore: -4 },
      },
    }],
    missingAnalysis: { coverage: 0.3, missingConcepts: ["proceso"] },
  });

  assert.equal(out.hasSuggestion, true);
  assert.ok(out.suggestions.some((s) => s.type === "create_new_neuron"));
  assert.ok(out.suggestions.some((s) => s.type === "improve_existing_neuron"));
});
