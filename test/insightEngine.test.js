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

import { runInsightEngine } from "../src/neuro/insightEngine.js";
import { detectRecurringAcrossTime, detectResolvedPattern, detectTrendPattern } from "../src/neuro/insightPatterns.js";

test("runInsightEngine genera insights con señal suficiente", async () => {
  reset();
  const activated = [
    { neuron: { id: "a", type: "memory", core: { concept: "saturación", domain: "emocional", summary: "muchas tareas" }, triggers: ["saturación", "bloqueo"], emotion: "fear", source: { kind: "user" }, connections: [], weight: 0.7 }, score: 0.9 },
    { neuron: { id: "b", type: "memory", core: { concept: "quiero avanzar", domain: "work", summary: "dispersión" }, triggers: ["quiero", "avanzar", "dispersión"], emotion: "fear", source: { kind: "user" }, connections: [], weight: 0.6 }, score: 0.8 },
  ];
  const out = await runInsightEngine({ activated, contextEntities: [], options: { interpretationMode: "objective" } });
  assert.ok(out.insights.length >= 1);
  assert.ok(out.insights.length <= 3);
});

test("runInsightEngine no genera ruido con señal insuficiente", async () => {
  reset();
  const out = await runInsightEngine({ activated: [{ neuron: { id: "x", type: "memory", core: { concept: "hola", domain: "general", summary: "ok" }, triggers: [], source: { kind: "user" }, connections: [], weight: 0.2, emotion: "neutral" }, score: 0.2 }], options: { minConfidence: 0.7 } });
  assert.equal(out.insights.length, 0);
});

test("detectRecurringAcrossTime detecta recurrencia temporal", () => {
  const current = [{ neuron: { id: "c1", core: { concept: "bloqueo", domain: "work", summary: "" }, triggers: ["bloqueo", "urgencia"] }, score: 0.8 }];
  const hist = [{ neuron: { id: "h1", core: { concept: "bloqueo", domain: "work", summary: "" }, triggers: ["bloqueo", "sobrecarga"] }, score: 0.6 }];
  const p = detectRecurringAcrossTime(current, hist);
  assert.ok(p);
  assert.equal(p.type, "recurring_pattern");
});

test("detectResolvedPattern detecta patrón resuelto", () => {
  const neurons = [
    { neuron: { id: "h1", core: { concept: "crisis", domain: "emocional", summary: "" }, temporal: { date: "2025-01-01" } }, score: 0.8 },
    { neuron: { id: "h2", core: { concept: "crisis", domain: "emocional", summary: "" }, temporal: { date: "2025-01-15" } }, score: 0.7 },
    { neuron: { id: "r1", core: { concept: "crisis", domain: "emocional", summary: "" }, temporal: { date: "2026-03-18" } }, score: 0.2 },
  ];
  const p = detectResolvedPattern(neurons, { now: "2026-03-19T00:00:00.000Z", recentWindowDays: 30 });
  assert.ok(p);
  assert.equal(p.type, "resolved_pattern");
});

test("detectTrendPattern detecta tendencia", () => {
  const neurons = [
    { neuron: { id: "t1", core: { concept: "ansiedad", domain: "emocional", summary: "" }, temporal: { date: "2025-01-01" } }, score: 0.9 },
    { neuron: { id: "t2", core: { concept: "ansiedad", domain: "emocional", summary: "" }, temporal: { date: "2025-06-01" } }, score: 0.8 },
    { neuron: { id: "t3", core: { concept: "ansiedad", domain: "emocional", summary: "" }, temporal: { date: "2026-03-18" } }, score: 0.3 },
  ];
  const p = detectTrendPattern(neurons);
  assert.ok(p);
  assert.equal(p.type, "trend");
});
