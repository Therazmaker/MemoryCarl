import test from "node:test";
import assert from "node:assert/strict";

import {
  clusterActivatedNeurons,
  detectDominantPattern,
  detectTensionPattern,
  detectEntityContextPattern,
} from "../src/neuro/insightPatterns.js";

function a(id, patch = {}) {
  return {
    neuron: {
      id,
      type: "memory",
      core: { concept: "base", domain: "emocional", summary: "" },
      triggers: [],
      connections: [],
      emotion: "neutral",
      weight: 0.6,
      source: { kind: "user", ref: "" },
      ...patch,
    },
    score: 0.7,
  };
}

test("clusterActivatedNeurons agrupa por afinidad básica", () => {
  const activated = [
    a("n1", { core: { concept: "bloqueo", domain: "emocional", summary: "saturación mental" }, emotion: "fear", triggers: ["bloqueo", "saturación"] }),
    a("n2", { core: { concept: "urgencia trabajo", domain: "work", summary: "muchas tareas" }, emotion: "fear", triggers: ["urgencia", "tareas"] }),
    a("n3", { core: { concept: "Fergis", domain: "relationships", summary: "tensión por proyecto" }, source: { kind: "manual", ref: "context_window" } }),
  ];
  const clusters = clusterActivatedNeurons(activated);
  assert.ok(clusters.length >= 2);
  assert.ok(clusters.some((c) => c.manualEntities.includes("Fergis")));
});

test("detectDominantPattern detecta saturación + bloqueo", () => {
  const pattern = detectDominantPattern([
    {
      id: "cluster_001",
      label: "emocional + saturación",
      dominantConcepts: ["saturación", "bloqueo", "inicio"],
      neuronIds: ["a", "b"],
      domains: ["emocional"],
      emotion: "fear",
      weight: 0.9,
      manualEntities: [],
    },
  ]);
  assert.equal(pattern?.type, "dominant_pattern");
  assert.match(pattern?.formula || "", /sobrecarga|bloqueo/i);
  assert.ok((pattern?.confidence || 0) >= 0.75);
});

test("detectTensionPattern detecta intención + dispersión", () => {
  const pattern = detectTensionPattern([
    { id: "c1", dominantConcepts: ["quiero", "avanzar", "sobrecarga"], neuronIds: ["a"], domains: ["work"], emotion: "fear", weight: 0.8 },
  ]);
  assert.equal(pattern?.type, "tension");
  assert.match(pattern?.formula || "", /impulso/i);
});

test("detectEntityContextPattern reconoce contexto manual de trabajo", () => {
  const pattern = detectEntityContextPattern([
    a("m1", { core: { concept: "Fergis", domain: "relationships", summary: "" }, source: { kind: "manual", ref: "context_window" } }),
    a("w1", { core: { concept: "Proyecto Atlas", domain: "work", summary: "deadline" }, triggers: ["trabajo", "proyecto"] }),
  ]);
  assert.equal(pattern?.type, "work_context");
  assert.ok((pattern?.manualEntities || []).includes("Fergis"));
});
