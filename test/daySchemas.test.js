/**
 * daySchemas.test.js — Tests para daySchemas.js
 * MemoryCarl
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  createDay,
  validateDay,
  sanitizeDay,
  DAY_STATUSES,
  VALID_EMOTIONS,
  VALID_IMPORTANCES,
} from "../src/day/daySchemas.js";

// ---- Tests: createDay ----

test("createDay crea un objeto con estructura completa", () => {
  const day = createDay("2026-03-22");
  assert.equal(day.date, "2026-03-22");
  assert.ok(day.id.startsWith("day_"));
  assert.equal(day.status, "open");
  assert.ok(Array.isArray(day.rawChat));
  assert.ok(Array.isArray(day.linkedNeurons));
  assert.ok(Array.isArray(day.memoryIds));
  assert.ok(Array.isArray(day.dominantThemes));
  assert.ok(Array.isArray(day.insights));
  assert.equal(day.summary, "");
  assert.equal(day.dominantEmotion, "neutral");
  assert.equal(day.geminiProcessed, false);
  assert.equal(day.geminiLastProcessedAt, null);
  assert.equal(day.closedAt, null);
  assert.equal(day.isMilestone, false);
  assert.ok(day.createdAt);
  assert.ok(day.updatedAt);
  assert.ok(day.meta && typeof day.meta === "object");
  assert.equal(day.meta.importance, "medium");
});

test("createDay usa la fecha actual si no se provee fecha", () => {
  const today = new Date().toISOString().slice(0, 10);
  const day = createDay();
  assert.equal(day.date, today);
});

test("createDay usa la fecha actual si el formato es inválido", () => {
  const today = new Date().toISOString().slice(0, 10);
  const day = createDay("not-a-date");
  assert.equal(day.date, today);
});

test("createDay genera IDs únicos", () => {
  const d1 = createDay("2026-03-22");
  const d2 = createDay("2026-03-22");
  assert.notEqual(d1.id, d2.id);
});

// ---- Tests: validateDay ----

test("validateDay acepta un día válido", () => {
  const day = createDay("2026-03-22");
  const result = validateDay(day);
  assert.equal(result.valid, true);
});

test("validateDay rechaza null", () => {
  const result = validateDay(null);
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);
});

test("validateDay rechaza un objeto sin id", () => {
  const day = { ...createDay("2026-03-22"), id: "invalid_id" };
  const result = validateDay(day);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("id")));
});

test("validateDay rechaza fecha con formato incorrecto", () => {
  const day = { ...createDay("2026-03-22"), date: "22-03-2026" };
  const result = validateDay(day);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("date")));
});

test("validateDay rechaza status inválido", () => {
  const day = { ...createDay("2026-03-22"), status: "pending" };
  const result = validateDay(day);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("status")));
});

test("validateDay rechaza rawChat no array", () => {
  const day = { ...createDay("2026-03-22"), rawChat: "not an array" };
  const result = validateDay(day);
  assert.equal(result.valid, false);
});

test("validateDay rechaza emoción desconocida", () => {
  const day = { ...createDay("2026-03-22"), dominantEmotion: "envidia" };
  const result = validateDay(day);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("dominantEmotion")));
});

test("validateDay acepta emociones válidas", () => {
  for (const emotion of VALID_EMOTIONS) {
    const day = { ...createDay("2026-03-22"), dominantEmotion: emotion };
    const result = validateDay(day);
    assert.equal(result.valid, true, `Emoción '${emotion}' debería ser válida`);
  }
});

test("validateDay rechaza meta.importance inválida", () => {
  const day = { ...createDay("2026-03-22"), meta: { importance: "critical" } };
  const result = validateDay(day);
  assert.equal(result.valid, false);
});

// ---- Tests: sanitizeDay ----

test("sanitizeDay retorna objeto completo dado un objeto vacío", () => {
  const result = sanitizeDay({});
  assert.ok(result.id.startsWith("day_"));
  assert.equal(result.status, "open");
  assert.ok(Array.isArray(result.rawChat));
  assert.ok(Array.isArray(result.linkedNeurons));
  assert.equal(result.dominantEmotion, "neutral");
  assert.equal(result.meta.importance, "medium");
});

test("sanitizeDay retorna createDay() dado null", () => {
  const result = sanitizeDay(null);
  assert.ok(result.id.startsWith("day_"));
});

test("sanitizeDay corrige status inválido a open", () => {
  const result = sanitizeDay({ ...createDay("2026-03-22"), status: "unknown" });
  assert.equal(result.status, "open");
});

test("sanitizeDay corrige emoción inválida a neutral", () => {
  const result = sanitizeDay({ ...createDay("2026-03-22"), dominantEmotion: "ira_profunda" });
  assert.equal(result.dominantEmotion, "neutral");
});

test("sanitizeDay preserva datos válidos", () => {
  const day = createDay("2026-03-22");
  day.summary = "Resumen importante";
  day.dominantEmotion = "alegría";
  day.insights = ["insight 1", "insight 2"];
  const result = sanitizeDay(day);
  assert.equal(result.summary, "Resumen importante");
  assert.equal(result.dominantEmotion, "alegría");
  assert.deepEqual(result.insights, ["insight 1", "insight 2"]);
});

test("sanitizeDay normaliza memoryIds desde campo memories (backward compat)", () => {
  const day = { ...createDay("2026-03-22"), memories: ["mem_1", "mem_2"], memoryIds: undefined };
  const result = sanitizeDay(day);
  assert.ok(result.memoryIds.includes("mem_1"));
  assert.ok(result.memoryIds.includes("mem_2"));
});

test("sanitizeDay filtra rawChat inválidos", () => {
  const day = { ...createDay("2026-03-22"), rawChat: [null, { role: "user", content: "ok" }, 42] };
  const result = sanitizeDay(day);
  assert.equal(result.rawChat.length, 1);
  assert.equal(result.rawChat[0].content, "ok");
});

test("sanitizeDay corrige meta.importance inválida a medium", () => {
  const day = { ...createDay("2026-03-22"), meta: { importance: "ultra" } };
  const result = sanitizeDay(day);
  assert.equal(result.meta.importance, "medium");
});

test("sanitizeDay preserva isMilestone", () => {
  const day = { ...createDay("2026-03-22"), isMilestone: true };
  const result = sanitizeDay(day);
  assert.equal(result.isMilestone, true);
});

// ---- Tests: constantes ----

test("DAY_STATUSES contiene open y closed", () => {
  assert.ok(DAY_STATUSES.includes("open"));
  assert.ok(DAY_STATUSES.includes("closed"));
});

test("VALID_IMPORTANCES contiene low, medium, high", () => {
  assert.ok(VALID_IMPORTANCES.includes("low"));
  assert.ok(VALID_IMPORTANCES.includes("medium"));
  assert.ok(VALID_IMPORTANCES.includes("high"));
});
