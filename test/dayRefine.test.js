/**
 * dayRefine.test.js — Tests para dayRefine.js
 * MemoryCarl
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

// ---- Imports ----
import {
  validateDayRefinement,
  previewDayRefinement,
  applyDayRefinement,
} from "../src/day/dayRefine.js";

import {
  getCurrentDay,
  getAllDays,
  getDayByDate,
  updateDay,
} from "../src/day/dayStore.js";

// ---- Helper ----
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Tests: validateDayRefinement ----

test("validateDayRefinement acepta refinement válido completo", () => {
  const refinement = {
    improvedSummary: "Resumen mejorado",
    correctedEmotion: "alegría",
    refinedThemes: ["trabajo", "logros"],
    insights: ["Fue un día productivo"],
    neuronAdjustments: {
      create: [],
      update: [],
      merge: [],
      remove: [],
    },
  };
  const result = validateDayRefinement(refinement);
  assert.equal(result.valid, true);
});

test("validateDayRefinement acepta refinement parcial (solo improvedSummary)", () => {
  const result = validateDayRefinement({ improvedSummary: "Solo resumen" });
  assert.equal(result.valid, true);
});

test("validateDayRefinement rechaza null", () => {
  const result = validateDayRefinement(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validateDayRefinement rechaza si improvedSummary no es string", () => {
  const result = validateDayRefinement({ improvedSummary: 123 });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("improvedSummary")));
});

test("validateDayRefinement rechaza si refinedThemes no es array", () => {
  const result = validateDayRefinement({ refinedThemes: "trabajo" });
  assert.equal(result.valid, false);
});

test("validateDayRefinement rechaza neuronAdjustments inválido", () => {
  const result = validateDayRefinement({ neuronAdjustments: "invalid" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("neuronAdjustments")));
});

test("validateDayRefinement rechaza neuronAdjustments.create no array", () => {
  const result = validateDayRefinement({ neuronAdjustments: { create: "no" } });
  assert.equal(result.valid, false);
});

test("validateDayRefinement acepta neuronAdjustments con arrays vacíos", () => {
  const result = validateDayRefinement({
    neuronAdjustments: { create: [], update: [], merge: [], remove: [] },
  });
  assert.equal(result.valid, true);
});

// ---- Tests: previewDayRefinement ----

test("previewDayRefinement retorna preview con cambios", () => {
  resetStorage();
  const day = getCurrentDay();
  updateDay({ ...day, summary: "resumen original", dominantEmotion: "neutral" });
  const dayUpdated = getDayByDate(todayStr());

  const refinement = {
    improvedSummary: "Resumen mejorado",
    correctedEmotion: "alegría",
    refinedThemes: ["trabajo"],
  };
  const preview = previewDayRefinement(dayUpdated.id, refinement);
  assert.ok(preview);
  assert.equal(preview.valid, true);
  assert.equal(preview.changes.summary.from, "resumen original");
  assert.equal(preview.changes.summary.to, "Resumen mejorado");
  assert.equal(preview.changes.dominantEmotion.from, "neutral");
  assert.equal(preview.changes.dominantEmotion.to, "alegría");
});

test("previewDayRefinement retorna null si dayId no existe", () => {
  resetStorage();
  const result = previewDayRefinement("day_fake_id", { improvedSummary: "test" });
  assert.equal(result, null);
});

test("previewDayRefinement retorna null si refinement es null", () => {
  resetStorage();
  const result = previewDayRefinement("any_id", null);
  assert.equal(result, null);
});

test("previewDayRefinement retorna valid:false si refinement es inválido", () => {
  resetStorage();
  const day = getCurrentDay();
  const result = previewDayRefinement(day.id, { refinedThemes: "not-an-array" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

// ---- Tests: applyDayRefinement ----

test("applyDayRefinement actualiza summary y emoción del día", () => {
  resetStorage();
  const day = getCurrentDay();
  const refinement = {
    improvedSummary: "Resumen Gemini",
    correctedEmotion: "alegría",
    refinedThemes: ["trabajo", "logros"],
    insights: ["Fue productivo"],
  };
  const result = applyDayRefinement(day.id, refinement);
  assert.ok(result);
  assert.equal(result.summary, "Resumen Gemini");
  assert.equal(result.dominantEmotion, "alegría");
  assert.deepEqual(result.dominantThemes, ["trabajo", "logros"]);
  assert.ok(result.geminiProcessed);
  assert.ok(result.geminiLastProcessedAt);
});

test("applyDayRefinement retorna null si dayId no existe", () => {
  resetStorage();
  const result = applyDayRefinement("day_fake", { improvedSummary: "x" });
  assert.equal(result, null);
});

test("applyDayRefinement retorna null si refinement es null", () => {
  resetStorage();
  const day = getCurrentDay();
  const result = applyDayRefinement(day.id, null);
  assert.equal(result, null);
});

test("applyDayRefinement no rompe el estado si refinement tiene campos inesperados", () => {
  resetStorage();
  const day = getCurrentDay();
  updateDay({ ...day, summary: "original" });
  const dayUpdated = getDayByDate(todayStr());
  const result = applyDayRefinement(dayUpdated.id, { unexpectedField: 999 });
  // No hay error, pero summary sigue siendo el mismo (no hubo improvedSummary)
  assert.ok(result);
  assert.equal(result.summary, "original");
  assert.ok(result.geminiProcessed);
});

test("applyDayRefinement no aplica refinement inválido", () => {
  resetStorage();
  const day = getCurrentDay();
  // refinedThemes como string en lugar de array es inválido
  const result = applyDayRefinement(day.id, { refinedThemes: "invalido" });
  assert.equal(result, null);
});

test("applyDayRefinement preserva el día si Gemini falla (simulado)", () => {
  resetStorage();
  const day = getCurrentDay();
  updateDay({ ...day, summary: "resumen seguro" });
  const safeDay = getDayByDate(todayStr());

  // refinement válido pero sin improvedSummary — summary debe preservarse
  const result = applyDayRefinement(safeDay.id, { correctedEmotion: "calma" });
  assert.ok(result);
  assert.equal(result.summary, "resumen seguro");
  assert.equal(result.dominantEmotion, "calma");
});

test("applyDayRefinement con skipNeurons no procesa neuronAdjustments", () => {
  resetStorage();
  const day = getCurrentDay();
  const refinement = {
    improvedSummary: "ok",
    neuronAdjustments: {
      remove: ["nrn_fake_1"],
    },
  };
  // Con skipNeurons=true no debe intentar borrar neuronas inexistentes
  const result = applyDayRefinement(day.id, refinement, { skipNeurons: true });
  assert.ok(result);
  assert.equal(result.summary, "ok");
});

test("applyDayRefinement registra geminiLastProcessedAt", () => {
  resetStorage();
  const day = getCurrentDay();
  const result = applyDayRefinement(day.id, { improvedSummary: "timestamp test" });
  assert.ok(result.geminiLastProcessedAt, "geminiLastProcessedAt debe estar definido");
  assert.ok(typeof result.geminiLastProcessedAt === "string", "geminiLastProcessedAt debe ser string");
  // Debe ser un ISO date string válido
  assert.ok(!isNaN(new Date(result.geminiLastProcessedAt).getTime()), "geminiLastProcessedAt debe ser fecha válida");
});

// ---- Tests: integración con dayStore ----

test("applyDayRefinement persiste cambios en el store", () => {
  resetStorage();
  const day = getCurrentDay();
  applyDayRefinement(day.id, { improvedSummary: "persistido" });
  const loaded = getDayByDate(todayStr());
  assert.equal(loaded.summary, "persistido");
});

test("múltiples refinamientos sucesivos se acumulan correctamente", () => {
  resetStorage();
  const day = getCurrentDay();
  applyDayRefinement(day.id, { improvedSummary: "primero", correctedEmotion: "alegría" });
  const intermediate = getDayByDate(todayStr());
  applyDayRefinement(intermediate.id, { refinedThemes: ["tema1", "tema2"] });
  const final = getDayByDate(todayStr());
  assert.equal(final.summary, "primero");
  assert.equal(final.dominantEmotion, "alegría");
  assert.deepEqual(final.dominantThemes, ["tema1", "tema2"]);
});
