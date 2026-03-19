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

function resetStorage() { Object.keys(store).forEach((k) => delete store[k]); }

import { processNeuroInput } from "../src/neuro/neurocore.js";
import { saveManyNeurons } from "../src/neuro/neuronStore.js";
import { createNeuron } from "../src/neuro/schemas.js";

test("neurocore returns bootstrapState and mode in payload", async () => {
  resetStorage();
  const neurons = Array.from({ length: 4 }, (_, i) => createNeuron({
    core: { concept: `concept_${i}`, domain: "personal", summary: `summary ${i}` },
    triggers: ["ansiedad", "diario", `tag_${i}`],
    weight: 0.6,
  }));
  saveManyNeurons(neurons);

  const result = await processNeuroInput("Hoy en mi diario sentí ansiedad y aprendí algo.", {
    mode: "journal",
    skipGeneration: true,
    history: [],
  });

  assert.equal(result.mode, "journal");
  assert.equal(result.bootstrapState.enabled, true);
  assert.equal(result.bootstrapState.level, "strong");
  assert.equal(result.trace.mode, "journal");
  assert.ok(result.trace.bootstrapState);
  assert.ok(result.premiumDecision.rulePath.startsWith("bootstrap_"));
});

test("neurocore includes activatedManual and contextEntities when input mentions alias", async () => {
  resetStorage();
  saveManyNeurons([
    createNeuron({
      id: "m_fergis",
      type: "person",
      core: { concept: "Fergis", domain: "relationships", summary: "pareja" },
      source: { kind: "manual", ref: "context_window" },
      meta: { aliases: ["mi esposa"], manualCategory: "people", priority: "high", pin: true },
    }),
    createNeuron({ id: "p1", type: "project", core: { concept: "Proyecto Atlas", domain: "work", summary: "proyecto actual" } }),
  ]);

  const result = await processNeuroInput("Mi esposa está estresada por el proyecto", { skipGeneration: true, history: [] });
  assert.ok(Array.isArray(result.activatedManual));
  assert.ok(result.activatedManual.some((m) => m.concept === "Fergis"));
  assert.ok(result.contextEntities.includes("Fergis"));
});
