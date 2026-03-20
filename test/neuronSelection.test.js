import test from "node:test";
import assert from "node:assert/strict";

import {
  evaluateTriggerQuality,
  computeFinalNeuronScore,
  enforceNeuronDiversity,
  detectBridgeNeuronNeed,
  neuronScoreWeights,
} from "../src/neuro/neuronSelection.js";
import { createNeuron } from "../src/neuro/schemas.js";

function makeEntry({ id, concept, summary, triggers = [], semantic = 0.5, keyword = 0.5, weight = 0.5, recency = 0.5, feedback = 0, score = 0.5 }) {
  return {
    neuron: createNeuron({
      id,
      core: { concept, domain: "personal", summary },
      triggers,
      weight,
    }),
    score,
    components: {
      semantic,
      keyword,
      weight,
      recency,
      neuronFeedbackBoost: feedback,
    },
  };
}

test("neurona sin triggers es penalizada", () => {
  const neuron = createNeuron({ core: { concept: "test", domain: "x", summary: "x" }, triggers: [] });
  assert.equal(evaluateTriggerQuality(neuron, "mensaje"), -0.4);
});

test("neurona con 1 trigger tiene score menor que neurona con 4 triggers", () => {
  const oneTrigger = createNeuron({ core: { concept: "A", domain: "x", summary: "x" }, triggers: ["terapia"] });
  const fourTriggers = createNeuron({ core: { concept: "B", domain: "x", summary: "x" }, triggers: ["terapia", "sesión", "psicólogo", "acompañamiento"] });

  const q1 = evaluateTriggerQuality(oneTrigger, "hoy tuve terapia");
  const q4 = evaluateTriggerQuality(fourTriggers, "hoy tuve terapia");
  assert.ok(q1 < q4);
});

test("top-K devuelve máximo 5 neuronas", async () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({
    ...makeEntry({ id: `n_${i}`, concept: `concepto ${i}`, summary: `resumen ${i}`, triggers: [`tag${i}`, "foco"] }),
    scoreFinal: 0.9 - i * 0.02,
  }));

  const out = await enforceNeuronDiversity(entries, { topK: 5 });
  assert.ok(out.selected.length <= 5);
});

test("diversidad elimina neuronas similares", async () => {
  const a = { ...makeEntry({ id: "a", concept: "dinero personal", summary: "finanzas y gastos", triggers: ["dinero", "gastos"] }), scoreFinal: 0.8 };
  const b = { ...makeEntry({ id: "b", concept: "finanzas personales", summary: "manejo de dinero y gastos", triggers: ["finanzas", "dinero"] }), scoreFinal: 0.79 };
  const c = { ...makeEntry({ id: "c", concept: "salud", summary: "hábitos de ejercicio", triggers: ["salud", "ejercicio"] }), scoreFinal: 0.7 };

  const out = await enforceNeuronDiversity([a, b, c], { topK: 5 });
  assert.equal(out.selected.length, 2);
  assert.ok(out.removed.some((r) => r.id === "b"));
});

test("neuronas redundantes no pasan juntas", async () => {
  const entries = [
    { ...makeEntry({ id: "n1", concept: "gastos hogar", summary: "control de gastos", triggers: ["gastos", "hogar"] }), scoreFinal: 0.9 },
    { ...makeEntry({ id: "n2", concept: "finanzas hogar", summary: "control financiero", triggers: ["finanzas", "presupuesto"] }), scoreFinal: 0.88 },
    { ...makeEntry({ id: "n3", concept: "aprendizaje", summary: "estudio diario", triggers: ["estudio", "aprendizaje"] }), scoreFinal: 0.85 },
  ];

  const out = await enforceNeuronDiversity(entries, { topK: 5 });
  const ids = out.selected.map((x) => x.neuron.id);
  assert.ok(!(ids.includes("n1") && ids.includes("n2")));
});

test("bridge neuron se sugiere con coverage bajo", () => {
  const activated = [
    { ...makeEntry({ id: "weak_1", concept: "trabajo", summary: "tema laboral", triggers: ["trabajo"] }), scoreFinal: 0.31 },
    { ...makeEntry({ id: "weak_2", concept: "estrés", summary: "tensión general", triggers: ["estrés"] }), scoreFinal: 0.34 },
    { ...makeEntry({ id: "weak_3", concept: "agenda", summary: "organización", triggers: ["agenda"] }), scoreFinal: 0.29 },
  ];

  const result = detectBridgeNeuronNeed({
    input: "Hoy tuve mi sesión psicológica y aprendí algo importante",
    activated,
    finalSelection: activated,
    missingAnalysis: { coverage: 0.25 },
  });

  assert.equal(result.bridgeSuggested, true);
  assert.equal(result.bridgeSuggestion.type, "bridge");
});

test("scoring respeta pesos definidos", () => {
  const entry = makeEntry({
    id: "score_1",
    concept: "terapia",
    summary: "sesión psicológica",
    triggers: ["terapia", "sesión", "psicólogo", "acompañamiento"],
    semantic: 1,
    keyword: 1,
    weight: 1,
    recency: 1,
    feedback: 0.08,
  });

  const result = computeFinalNeuronScore(entry, "tuve terapia con psicólogo");
  const expected =
    neuronScoreWeights.semantic * 1 +
    neuronScoreWeights.keyword * 1 +
    neuronScoreWeights.weight * 1 +
    neuronScoreWeights.recency * 1 +
    neuronScoreWeights.feedback * 1 +
    neuronScoreWeights.triggerQuality * result.triggerQuality;
  assert.ok(Math.abs(result.score - expected) < 1e-9);
});
