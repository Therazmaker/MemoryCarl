import test from "node:test";
import assert from "node:assert/strict";

import {
  findRelevantMemories,
  computeMemoryRelevanceScore,
  rankMemories,
  MEMORY_RECALL_THRESHOLD,
} from "../src/memory/memoryRecall.js";

const activatedNeurons = [
  { neuron: { id: "n_work_focus", triggers: ["trabajo", "foco", "ansiedad"] } },
  { neuron: { id: "n_rel_family", triggers: ["familia", "casa"] } },
];

const memories = [
  {
    id: "m_focus",
    title: "Ataque de ansiedad por entrega",
    text: "En el trabajo sentí ansiedad por la entrega y respiré antes de priorizar.",
    tags: ["trabajo", "ansiedad", "prioridades"],
    emotion: "fear",
    linkedNeurons: ["n_work_focus"],
    date: "2026-01-03",
  },
  {
    id: "m_family",
    title: "Domingo familiar",
    text: "Pasé el día con mi familia en calma.",
    tags: ["familia", "hogar"],
    emotion: "joy",
    linkedNeurons: ["n_rel_family"],
    date: "2026-01-10",
  },
  {
    id: "m_random",
    title: "Viaje en tren",
    text: "Tomé un tren y leí una novela histórica.",
    tags: ["viaje", "lectura"],
    emotion: "neutral",
    linkedNeurons: ["n_other"],
    date: "2025-11-20",
  },
];

test("input similar a memoria detecta recall relevante", () => {
  const result = findRelevantMemories(
    "Estoy con ansiedad por el trabajo y necesito priorizar para la entrega.",
    memories,
    activatedNeurons,
  );

  assert.ok(result.ranked.length >= 1);
  assert.equal(result.ranked[0].memory.id, "m_focus");
  assert.ok(result.ranked[0].score >= MEMORY_RECALL_THRESHOLD);
});

test("input no relacionado no devuelve recall", () => {
  const result = findRelevantMemories(
    "¿Cuál es la capital de Islandia y su población?",
    memories,
    activatedNeurons,
  );

  assert.equal(result.ranked.length, 0);
});

test("múltiples memorias se ordenan por score descendente", () => {
  const context = {
    activeNeuronIds: ["n_work_focus", "n_rel_family"],
    activeTags: ["familia", "trabajo", "ansiedad"],
    inputTokens: ["trabajo", "ansiedad", "familia"],
    inputEmotion: "fear",
    recentMemoryIds: [],
  };
  const ranked = rankMemories(memories, context);
  assert.equal(ranked[0].memory.id, "m_focus");
  assert.ok(ranked[0].score >= ranked[1].score);
  assert.ok(ranked[1].score >= ranked[2].score);
});

test("sin neuronas activas aplica fallback por tags", () => {
  const scoreResult = computeMemoryRelevanceScore(memories[0], {
    activeNeuronIds: [],
    activeTags: ["ansiedad", "trabajo", "priorizar"],
    inputTokens: ["ansiedad", "trabajo", "priorizar"],
    inputEmotion: "fear",
    recentMemoryIds: [],
  });

  assert.equal(scoreResult.signals.neuronOverlap, 0);
  assert.ok(scoreResult.signals.fallbackBoost > 0);
  assert.ok(scoreResult.score >= 0.65);
});

test("threshold y anti-spam evitan repetir memoria continuamente", () => {
  const result = findRelevantMemories(
    "Otra vez ansiedad por trabajo y entrega.",
    memories,
    activatedNeurons,
    {
      threshold: 0.65,
      recentMemoryIds: ["m_focus"],
      maxResults: 3,
    },
  );

  assert.equal(result.ranked.some((entry) => entry.memory.id === "m_focus"), false);
});
