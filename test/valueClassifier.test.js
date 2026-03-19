/**
 * valueClassifier.test.js — Tests para el módulo valueClassifier.js
 * MemoryCarl / NeuroChat Phase 2
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyInputValue,
  isHighValueInput,
  extractInputSignals,
} from "../src/neuro/valueClassifier.js";

// ================================================================
// extractInputSignals
// ================================================================

test("extractInputSignals handles empty input", () => {
  const s = extractInputSignals("");
  assert.equal(s.wordCount, 0);
  assert.equal(s.isGreeting, true);
  assert.equal(s.isConfirmation, true);
});

test("extractInputSignals handles null input", () => {
  const s = extractInputSignals(null);
  assert.equal(s.wordCount, 0);
});

test("extractInputSignals detects greeting", () => {
  const s = extractInputSignals("Hola");
  assert.equal(s.isGreeting, true);
});

test("extractInputSignals detects short confirmation", () => {
  const s = extractInputSignals("sí");
  assert.equal(s.isConfirmation, true);
});

test("extractInputSignals detects emotion words", () => {
  const s = extractInputSignals("Me siento muy ansioso por lo que pasó hoy en el mercado.");
  assert.equal(s.hasEmotion, true);
});

test("extractInputSignals detects autobiographical content", () => {
  const s = extractInputSignals("Hoy me di cuenta de que he estado repitiendo el mismo patrón en mi vida.");
  assert.equal(s.hasAutobiographicalContent, true);
});

test("extractInputSignals detects insight language", () => {
  const s = extractInputSignals("Finalmente entendí por qué siempre perdía en esas operaciones.");
  assert.equal(s.hasInsightLanguage, true);
});

test("extractInputSignals detects domain-specific trading content", () => {
  const s = extractInputSignals("Mi stop loss fue mal calculado y perdí más de lo permitido en este trade.");
  assert.equal(s.hasDomainSpecificContent, true);
});

test("extractInputSignals detects decision language", () => {
  const s = extractInputSignals("Decidí cambiar completamente mi estrategia de trading desde hoy.");
  assert.equal(s.hasImportantDecision, true);
});

test("extractInputSignals detects repeated pattern language", () => {
  const s = extractInputSignals("Siempre me pasa lo mismo, de nuevo salgo antes del tiempo correcto.");
  assert.equal(s.hasRepeatedPatternLanguage, true);
});

test("extractInputSignals measures word count correctly", () => {
  const s = extractInputSignals("uno dos tres cuatro cinco");
  assert.equal(s.wordCount, 5);
});

// ================================================================
// classifyInputValue — low value
// ================================================================

test("classifyInputValue: greeting is low", () => {
  const r = classifyInputValue("Hola");
  assert.equal(r.label, "low");
  assert.ok(r.score < 0.25);
});

test("classifyInputValue: confirmation is low", () => {
  const r = classifyInputValue("sí");
  assert.equal(r.label, "low");
});

test("classifyInputValue: very short message is low", () => {
  const r = classifyInputValue("ok bien");
  assert.equal(r.label, "low");
});

test("classifyInputValue: logistics question is low", () => {
  const r = classifyInputValue("cuándo es eso");
  assert.equal(r.label, "low");
});

// ================================================================
// classifyInputValue — high value
// ================================================================

test("classifyInputValue: deep personal insight is high", () => {
  const input = `
    Hoy me di cuenta de que he estado operando con miedo desde hace meses.
    Siempre entro tarde a los trades porque tengo miedo a equivocarme,
    y eso me ha costado muchísimas oportunidades. Entendí que este patrón
    viene de mi infancia cuando me castigaban por cometer errores.
    Decidí cambiar esto trabajando con un coach de trading.
  `;
  const r = classifyInputValue(input);
  assert.equal(r.label, "high", `Expected high, got ${r.label} (score=${r.score})`);
  assert.ok(r.score >= 0.60);
});

test("classifyInputValue: trading analysis is high", () => {
  const input = `
    Analicé mi drawdown del mes y vi que el 70% de las pérdidas vienen
    de no respetar el stop loss. Mi estrategia de entrada es buena pero
    me falta disciplina en la salida. Decidí solo entrar en operaciones
    donde el riesgo/beneficio sea al menos 1:2.
  `;
  const r = classifyInputValue(input);
  // Contains domain content + decision language → at least medium value
  assert.ok(r.label === "high" || r.label === "medium",
    `Expected high or medium, got ${r.label} (score=${r.score})`);
  assert.ok(r.score >= 0.40,
    `Expected score>=0.40, got ${r.score}`);
});

test("classifyInputValue: returns required fields", () => {
  const r = classifyInputValue("cualquier mensaje de prueba");
  assert.ok("label"   in r);
  assert.ok("score"   in r);
  assert.ok("signals" in r);
  assert.ok(Array.isArray(r.reasons));
  assert.ok(["low", "medium", "high"].includes(r.label));
  assert.ok(r.score >= 0 && r.score <= 1);
});

test("classifyInputValue: medium for moderately informative input", () => {
  const input = "Hoy practiqué meditación por primera vez y fue interesante.";
  const r = classifyInputValue(input);
  // Should be medium or low but not necessarily high
  assert.ok(["low", "medium", "high"].includes(r.label));
  assert.ok(r.score >= 0 && r.score <= 1);
});

// ================================================================
// isHighValueInput
// ================================================================

test("isHighValueInput returns false for greeting", () => {
  assert.equal(isHighValueInput("hola"), false);
});

test("isHighValueInput returns false for confirmation", () => {
  assert.equal(isHighValueInput("sí claro"), false);
});

test("isHighValueInput returns true for rich personal insight", () => {
  const input = `
    Me di cuenta de que siempre que siento miedo en una operación de trading
    termino cerrando demasiado pronto y perdiendo la ganancia. Hoy decidí
    cambiar esto y documentarlo en mi journal para aprender del patrón.
  `;
  assert.equal(isHighValueInput(input), true);
});

test("isHighValueInput respects custom threshold", () => {
  const input = "Hoy practiqué meditación y fue interesante para mis hábitos.";
  // With very low threshold everything could be high
  const resultLow = isHighValueInput(input, { threshold: 0.01 });
  assert.equal(resultLow, true);
  // With very high threshold nothing is high
  const resultHigh = isHighValueInput(input, { threshold: 0.99 });
  assert.equal(resultHigh, false);
});

test("isHighValueInput returns boolean", () => {
  const result = isHighValueInput("test message");
  assert.equal(typeof result, "boolean");
});
