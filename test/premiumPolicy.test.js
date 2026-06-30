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
function todayStr() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
}

const USAGE_KEY = "memorycarl_premium_usage";
function setUsedToday(used, limit = 20) {
  store[USAGE_KEY] = JSON.stringify({ date: todayStr(), used, limit, events: [] });
}

import { shouldUsePremiumGeneration } from "../src/neuro/premiumPolicy.js";
import { getBootstrapState, isBootstrapMode } from "../src/neuro/bootstrap.js";

const PERSONAL_MEDIUM_INPUT = "Hoy me sentí ansioso por una discusión familiar y escribí en mi diario para entender qué aprendí de eso.";
const TRIVIAL_INPUT = "hola";

const LOW_COVERAGE = { coverage: 0.19, missingConcepts: ["ansiedad"], needsGeneration: true };
const MID_COVERAGE = { coverage: 0.33, missingConcepts: ["reflexión"], needsGeneration: true };

test("bootstrap state helper with thresholds", () => {
  assert.equal(isBootstrapMode(4), true);
  assert.equal(getBootstrapState(4).level, "strong");
  assert.equal(getBootstrapState(10).level, "normal");
  assert.equal(getBootstrapState(20).level, "off");
});

test("premium allowed in bootstrap strong with medium personal input", () => {
  resetStorage();
  setUsedToday(2, 20);
  const result = shouldUsePremiumGeneration({
    userInput: PERSONAL_MEDIUM_INPUT,
    missingAnalysis: LOW_COVERAGE,
    history: [],
    mode: "journal",
    totalNeurons: 4,
  });
  assert.equal(result.usePremium, true);
  assert.equal(result.rulePath, "bootstrap_strong");
  assert.equal(result.bootstrapState.level, "strong");
});

test("premium allowed in journal mode with medium label during bootstrap", () => {
  resetStorage();
  setUsedToday(0, 20);
  const result = shouldUsePremiumGeneration({
    userInput: "Hoy escribo mi diario emocional sobre lo que sentí y lo que aprendí de mi reacción.",
    missingAnalysis: { coverage: 0.22, needsGeneration: true },
    history: [],
    mode: "journal",
    totalNeurons: 7,
  });
  assert.equal(result.usePremium, true);
});

test("premium blocked for trivial chat even in bootstrap", () => {
  resetStorage();
  setUsedToday(0, 20);
  const result = shouldUsePremiumGeneration({
    userInput: TRIVIAL_INPUT,
    missingAnalysis: LOW_COVERAGE,
    history: [],
    mode: "chat",
    totalNeurons: 4,
  });
  assert.equal(result.usePremium, false);
  assert.match(result.reasons[0], /trivial/i);
  assert.equal(result.reasonCode, "trivial_input");
});

test("normal policy path still used outside bootstrap", () => {
  resetStorage();
  setUsedToday(0, 20);
  const result = shouldUsePremiumGeneration({
    userInput: "Hoy me di cuenta de un patrón emocional profundo y decidí cambiarlo.",
    missingAnalysis: MID_COVERAGE,
    history: [],
    mode: "chat",
    totalNeurons: 20,
  });
  assert.equal(result.rulePath, "normal");
  assert.equal(result.bootstrapState.level, "off");
});

test("policy devuelve razón usable cuando coverage es suficiente", () => {
  resetStorage();
  setUsedToday(0, 20);
  const result = shouldUsePremiumGeneration({
    userInput: "Estoy revisando un proyecto personal y quiero ordenar lo que aprendí hoy.",
    missingAnalysis: { coverage: 0.9, needsGeneration: false },
    history: [],
    mode: "chat",
    totalNeurons: 30,
  });
  assert.equal(result.usePremium, false);
  assert.equal(result.reasonCode, "enough_coverage");
  assert.match(result.reasons[0], /parcial|crítico|coverage/i);
});
