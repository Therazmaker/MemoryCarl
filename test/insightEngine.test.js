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
