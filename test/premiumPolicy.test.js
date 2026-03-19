/**
 * premiumPolicy.test.js — Tests para el módulo premiumPolicy.js
 * MemoryCarl / NeuroChat Phase 2
 */

import test from "node:test";
import assert from "node:assert/strict";

// ---- Mock localStorage ----
const store = {};
if (typeof localStorage === "undefined") {
  globalThis.localStorage = {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { Object.keys(store).forEach((k) => delete store[k]); },
  };
}

function resetStorage() {
  Object.keys(store).forEach((k) => delete store[k]);
}

function todayStr() {
  const d = new Date();
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, "0"),
    String(d.getDate()).padStart(2, "0"),
  ].join("-");
}

const USAGE_KEY = "memorycarl_premium_usage";

function setUsedToday(used, limit = 20) {
  store[USAGE_KEY] = JSON.stringify({ date: todayStr(), used, limit, events: [] });
}

import { shouldUsePremiumGeneration } from "../src/neuro/premiumPolicy.js";

// ---- High-value input fixture ----
const HIGH_VALUE_INPUT = `
  Hoy me di cuenta de un patrón que llevo repitiendo meses en mi trading:
  siempre que siento miedo cierro posiciones demasiado pronto y pierdo ganancias.
  Entendí que esto viene de un miedo profundo a perder y decidí documentarlo
  y trabajarlo con disciplina en mi journal de trading diario.
`;

const LOW_VALUE_INPUT = "hola";

const LOW_COVERAGE_ANALYSIS = {
  coverage: 0.10,
  missingConcepts: ["miedo", "trading", "patrón"],
  reasons: ["cobertura de tokens baja"],
  needsGeneration: true,
};

const HIGH_COVERAGE_ANALYSIS = {
  coverage: 0.85,
  missingConcepts: [],
  reasons: [],
  needsGeneration: false,
};

// ================================================================
// Result shape
// ================================================================

test("shouldUsePremiumGeneration returns required fields", () => {
  resetStorage();
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history: [],
  });
  assert.ok("usePremium"  in result);
  assert.ok("reasons"     in result);
  assert.ok("classifier"  in result);
  assert.ok("usageState"  in result);
  assert.equal(typeof result.usePremium, "boolean");
  assert.ok(Array.isArray(result.reasons));
});

// ================================================================
// Premium ALLOWED
// ================================================================

test("shouldUsePremiumGeneration allows premium: low coverage + high-value input + calls available", () => {
  resetStorage();
  setUsedToday(0, 20);
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history: [],
  });
  assert.equal(result.usePremium, true,
    `Expected premium allowed. Reasons: ${result.reasons.join(", ")}`);
});

test("shouldUsePremiumGeneration reasons include positive signals when allowed", () => {
  resetStorage();
  setUsedToday(5, 20);
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history: [],
  });
  if (result.usePremium) {
    const joined = result.reasons.join(" ");
    assert.ok(
      joined.includes("cobertura") || joined.includes("restantes") || joined.includes("alto"),
      `Expected relevant reasons, got: ${joined}`
    );
  }
});

// ================================================================
// Premium BLOCKED: no calls
// ================================================================

test("shouldUsePremiumGeneration blocks premium when daily limit reached", () => {
  resetStorage();
  setUsedToday(20, 20);
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history: [],
  });
  assert.equal(result.usePremium, false);
  const joined = result.reasons.join(" ");
  assert.ok(joined.includes("límite") || joined.includes("limite") || joined.includes("limit"),
    `Expected limit reason, got: ${joined}`);
});

// ================================================================
// Premium BLOCKED: low-value input
// ================================================================

test("shouldUsePremiumGeneration blocks premium for trivial input", () => {
  resetStorage();
  setUsedToday(0, 20);
  const result = shouldUsePremiumGeneration({
    userInput: LOW_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history: [],
  });
  assert.equal(result.usePremium, false);
  const joined = result.reasons.join(" ");
  assert.ok(
    joined.includes("valor") || joined.includes("input"),
    `Expected value reason, got: ${joined}`
  );
});

// ================================================================
// Premium BLOCKED: sufficient coverage
// ================================================================

test("shouldUsePremiumGeneration blocks premium when coverage is sufficient", () => {
  resetStorage();
  setUsedToday(0, 20);
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: HIGH_COVERAGE_ANALYSIS,
    history: [],
  });
  assert.equal(result.usePremium, false);
  const joined = result.reasons.join(" ");
  assert.ok(joined.includes("cobertura"), `Expected coverage reason, got: ${joined}`);
});

// ================================================================
// Premium BLOCKED: cooldown
// ================================================================

test("shouldUsePremiumGeneration blocks premium if used recently (cooldown)", () => {
  resetStorage();
  setUsedToday(3, 20);
  // Simulate recent premium usage in history
  const history = [
    { role: "user",      content: "mensaje anterior", premiumUsed: false },
    { role: "assistant", content: "respuesta",         premiumUsed: true  },
  ];
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history,
    options: { cooldownTurns: 2 },
  });
  assert.equal(result.usePremium, false);
  const joined = result.reasons.join(" ");
  assert.ok(joined.includes("cooldown"), `Expected cooldown reason, got: ${joined}`);
});

test("shouldUsePremiumGeneration allows premium when cooldown is 0", () => {
  resetStorage();
  setUsedToday(0, 20);
  const history = [
    { role: "assistant", premiumUsed: true },
  ];
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history,
    options: { cooldownTurns: 0 },
  });
  assert.equal(result.usePremium, true);
});

// ================================================================
// usageState in result
// ================================================================

test("shouldUsePremiumGeneration result includes valid usageState", () => {
  resetStorage();
  setUsedToday(7, 20);
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history: [],
  });
  assert.equal(result.usageState.used, 7);
  assert.equal(result.usageState.remaining, 13);
  assert.equal(result.usageState.limit, 20);
});

// ================================================================
// classifier in result
// ================================================================

test("shouldUsePremiumGeneration result includes classifier details", () => {
  resetStorage();
  const result = shouldUsePremiumGeneration({
    userInput: HIGH_VALUE_INPUT,
    activated: [],
    missingAnalysis: LOW_COVERAGE_ANALYSIS,
    history: [],
  });
  assert.ok(result.classifier);
  assert.ok("label"  in result.classifier);
  assert.ok("score"  in result.classifier);
  assert.ok("signals" in result.classifier);
});
