import test from "node:test";
import assert from "node:assert/strict";

import {
  inferMemoryEmotion,
  inferMemoryImportance,
  extractSemanticTags,
  dedupeMemoryInsights,
  resolveLinkedNeuronDisplay,
  autoFixMemoryRecord,
} from "../src/memory/memoryStore.js";

test("inferMemoryEmotion evita neutral incorrecto", () => {
  const emotion = inferMemoryEmotion({ text: "Hoy es el primer día sin trabajo. No me puedo relajar." });
  assert.notEqual(emotion, "neutral");
  assert.ok(["sadness", "fear", "mixed"].includes(emotion));
});

test("inferMemoryImportance sube a high para transición crítica", () => {
  const importance = inferMemoryImportance({ text: "Renuncié al trabajo, fue un nuevo comienzo con mucha incertidumbre." });
  assert.equal(importance, "high");
});

test("extractSemanticTags devuelve tags útiles y sin basura", () => {
  const tags = extractSemanticTags("No estábamos alineados con Fergis en el trabajo y siento mucha presión e incertidumbre.");
  assert.ok(tags.includes("trabajo"));
  assert.ok(tags.some((t) => t.includes("desaline")));
  assert.ok(!tags.includes("bien"));
  assert.ok(!tags.includes("primer"));
});

test("dedupeMemoryInsights elimina duplicados por patrón base", () => {
  const deduped = dedupeMemoryInsights([
    { type: "pattern", title: "A", summary: "Tensión con Fergis" },
    { type: "pattern", title: "B", summary: "Tensión con Fergis" },
    { type: "pattern", title: "C", summary: "Ansiedad por dinero" },
  ]);
  assert.equal(deduped.length, 2);
});

test("resolveLinkedNeuronDisplay transforma IDs en conceptos", () => {
  const rows = resolveLinkedNeuronDisplay(
    { linkedNeurons: ["n1", "n_missing"] },
    [{ id: "n1", core: { concept: "ansiedad ante incertidumbre laboral", domain: "work" }, type: "memory" }],
  );
  assert.equal(rows[0].concept, "ansiedad ante incertidumbre laboral");
  assert.equal(rows[1].concept, "neurona no encontrada");
});

test("autoFixMemoryRecord corrige emoción/importance/tags", () => {
  const fixed = autoFixMemoryRecord({
    text: "No salió como esperaba, no me puedo relajar desde que perdí el trabajo",
    emotion: "neutral",
    importance: "medium",
    tags: ["bien"],
    linkedNeurons: ["n1", "n2"],
    relatedInsights: [{ type: "pattern", summary: "frustración laboral" }, { type: "pattern", summary: "frustración laboral" }],
  }, {
    neurons: [{ id: "n1", core: { concept: "tensión laboral" } }],
  });

  assert.notEqual(fixed.emotion, "neutral");
  assert.equal(fixed.importance, "high");
  assert.ok(fixed.tags.length >= 1);
  assert.equal(fixed.relatedInsights.length, 1);
  assert.deepEqual(fixed.linkedNeurons, ["n1"]);
});
