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

import {
  saveInsightBatch,
  getInsightHistory,
  computeInsightRecurrence,
  summarizeInsightTrend,
} from "../src/neuro/insightHistory.js";

test("insightHistory guarda batch y respeta límite", () => {
  reset();
  const saved = saveInsightBatch(Array.from({ length: 4 }, (_, i) => ({
    id: `i${i}`,
    type: "dominant_pattern",
    title: "t",
    summary: "summary largo suficiente",
    confidence: 0.7,
    domains: ["work"],
    basedOnNeurons: ["n1"],
    signals: { dominantConcepts: ["x"] },
    pattern: { formula: "A->B" },
    createdAt: new Date().toISOString(),
  })), { maxHistory: 3 });
  assert.equal(saved, 4);
  assert.equal(getInsightHistory({ maxHistory: 10 }).length, 3);
});

test("computeInsightRecurrence detecta repetición", () => {
  reset();
  saveInsightBatch([{ id: "h1", type: "dominant_pattern", title: "t", summary: "summary largo suficiente", confidence: 0.7, domains: ["work"], basedOnNeurons: ["n1", "n2"], signals: { dominantConcepts: ["bloqueo"] }, pattern: { formula: "A->B" }, createdAt: new Date().toISOString() }]);
  const score = computeInsightRecurrence({ type: "dominant_pattern", basedOnNeurons: ["n1", "n2"], signals: { dominantConcepts: ["bloqueo"] } }, getInsightHistory());
  assert.ok(score >= 0.6);
});

test("summarizeInsightTrend resume tipo recurrente", () => {
  reset();
  saveInsightBatch([
    { id: "h1", type: "tension", title: "t", summary: "summary largo suficiente", confidence: 0.7, domains: ["work"], basedOnNeurons: ["n1"], signals: { dominantConcepts: ["x"] }, pattern: { formula: "A->B" }, createdAt: new Date().toISOString() },
    { id: "h2", type: "tension", title: "t", summary: "summary largo suficiente", confidence: 0.7, domains: ["work"], basedOnNeurons: ["n2"], signals: { dominantConcepts: ["y"] }, pattern: { formula: "A->B" }, createdAt: new Date().toISOString() },
  ]);
  const trend = summarizeInsightTrend(getInsightHistory());
  assert.ok(trend.recurrentTypes.includes("tension"));
});
