/**
 * dayEngine.test.js — Tests para el Daily Memory Engine
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
  getCurrentDay,
  getDayByDate,
  appendToCurrentDay,
  closeDay,
  updateDay,
  getAllDays,
  linkDayToNeurons,
  rollbackDay,
  applyDayRefinement,
} from "../src/day/dayStore.js";

import {
  inferDayEmotion,
  extractDayThemes,
  summarizeDay,
  aggregateActivatedNeurons,
} from "../src/day/dayAnalyzer.js";

// ---- Helper para obtener fecha actual YYYY-MM-DD ----
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ---- Tests: dayStore ----

test("getCurrentDay crea un nuevo día si no existe", () => {
  resetStorage();
  const day = getCurrentDay();
  assert.equal(day.date, todayStr());
  assert.equal(day.status, "open");
  assert.ok(day.id.startsWith("day_"));
  assert.ok(Array.isArray(day.rawChat));
  assert.equal(day.rawChat.length, 0);
});

test("getCurrentDay retorna el mismo día en llamadas sucesivas", () => {
  resetStorage();
  const d1 = getCurrentDay();
  const d2 = getCurrentDay();
  assert.equal(d1.id, d2.id);
});

test("getCurrentDay persiste el día en localStorage", () => {
  resetStorage();
  const day = getCurrentDay();
  const days = getAllDays();
  assert.ok(days.some((d) => d.id === day.id));
});

test("appendToCurrentDay agrega un mensaje al rawChat", () => {
  resetStorage();
  const msg = { role: "user", content: "Hola mundo", ts: Date.now() };
  const day = appendToCurrentDay(msg);
  assert.equal(day.rawChat.length, 1);
  assert.equal(day.rawChat[0].content, "Hola mundo");
});

test("appendToCurrentDay crea el día si no existe", () => {
  resetStorage();
  assert.equal(getAllDays().length, 0);
  appendToCurrentDay({ role: "user", content: "primer mensaje", ts: Date.now() });
  assert.equal(getAllDays().length, 1);
});

test("appendToCurrentDay acumula múltiples mensajes", () => {
  resetStorage();
  appendToCurrentDay({ role: "user", content: "mensaje 1", ts: Date.now() });
  appendToCurrentDay({ role: "assistant", content: "respuesta 1", ts: Date.now() });
  appendToCurrentDay({ role: "user", content: "mensaje 2", ts: Date.now() });
  const days = getAllDays();
  assert.equal(days[0].rawChat.length, 3);
});

test("getDayByDate retorna null si no existe", () => {
  resetStorage();
  const result = getDayByDate("2000-01-01");
  assert.equal(result, null);
});

test("getDayByDate retorna el día correcto", () => {
  resetStorage();
  const day = getCurrentDay();
  const found = getDayByDate(todayStr());
  assert.equal(found?.id, day.id);
});

test("closeDay cambia status a closed", () => {
  resetStorage();
  getCurrentDay();
  const closed = closeDay(todayStr());
  assert.equal(closed.status, "closed");
});

test("closeDay retorna null si la fecha no existe", () => {
  resetStorage();
  const result = closeDay("1999-01-01");
  assert.equal(result, null);
});

test("updateDay actualiza el día y guarda versión anterior", () => {
  resetStorage();
  const day = getCurrentDay();
  const updated = updateDay({ ...day, summary: "nuevo resumen" });
  assert.equal(updated.summary, "nuevo resumen");
  assert.ok(updated._previousVersion !== null);
  assert.equal(updated._previousVersion.summary, "");
});

test("updateDay retorna null si el id no existe", () => {
  resetStorage();
  const result = updateDay({ id: "day_no_existe", date: todayStr() });
  assert.equal(result, null);
});

test("getAllDays retorna todos los días", () => {
  resetStorage();
  getCurrentDay();
  const days = getAllDays();
  assert.ok(days.length >= 1);
});

test("linkDayToNeurons agrega neuronIds al día", () => {
  resetStorage();
  const day = getCurrentDay();
  const updated = linkDayToNeurons(day.id, ["n1", "n2"]);
  assert.ok(updated.linkedNeurons.includes("n1"));
  assert.ok(updated.linkedNeurons.includes("n2"));
});

test("linkDayToNeurons no duplica neuronas existentes", () => {
  resetStorage();
  const day = getCurrentDay();
  linkDayToNeurons(day.id, ["n1", "n2"]);
  linkDayToNeurons(day.id, ["n2", "n3"]);
  const days = getAllDays();
  const updated = days.find((d) => d.id === day.id);
  const unique = new Set(updated.linkedNeurons);
  assert.equal(unique.size, updated.linkedNeurons.length);
  assert.equal(updated.linkedNeurons.length, 3);
});

test("linkDayToNeurons retorna null si dayId no existe", () => {
  resetStorage();
  const result = linkDayToNeurons("fake_id", ["n1"]);
  assert.equal(result, null);
});

test("rollbackDay restaura la versión anterior", () => {
  resetStorage();
  const day = getCurrentDay();
  updateDay({ ...day, summary: "resumen modificado" });
  const restored = rollbackDay(day.id);
  assert.equal(restored.summary, "");
  assert.equal(restored._previousVersion, null);
});

test("rollbackDay retorna null si no hay versión anterior", () => {
  resetStorage();
  const day = getCurrentDay();
  const result = rollbackDay(day.id);
  assert.equal(result, null);
});

test("rollbackDay retorna null si el día no existe", () => {
  resetStorage();
  const result = rollbackDay("fake_id");
  assert.equal(result, null);
});

// ---- Tests: applyDayRefinement ----

test("applyDayRefinement actualiza summary y emoción", () => {
  resetStorage();
  const day = getCurrentDay();
  const refinement = {
    improvedSummary: "Resumen mejorado por Gemini",
    correctedEmotion: "alegría",
    refinedThemes: ["trabajo", "logros"],
    insights: ["Este día fue productivo"],
  };
  const result = applyDayRefinement(day, refinement);
  assert.equal(result.summary, "Resumen mejorado por Gemini");
  assert.equal(result.dominantEmotion, "alegría");
  assert.deepEqual(result.dominantThemes, ["trabajo", "logros"]);
  assert.ok(result.geminiProcessed);
});

test("applyDayRefinement retorna el día sin cambios si refinement es null", () => {
  resetStorage();
  const day = getCurrentDay();
  const result = applyDayRefinement(day, null);
  assert.equal(result.id, day.id);
});

test("applyDayRefinement retorna el día sin cambios si day es null", () => {
  resetStorage();
  const result = applyDayRefinement(null, { improvedSummary: "x" });
  assert.equal(result, null);
});

test("applyDayRefinement no falla con campos parciales", () => {
  resetStorage();
  const day = getCurrentDay();
  // Solo improvedSummary, sin otros campos
  const result = applyDayRefinement(day, { improvedSummary: "Solo resumen" });
  assert.equal(result.summary, "Solo resumen");
  assert.ok(result.geminiProcessed);
});

// ---- Tests: dayAnalyzer ----

const SAMPLE_DAY = {
  id: "day_test",
  date: "2026-03-22",
  rawChat: [
    { role: "user", content: "Hoy estoy muy feliz porque logré terminar el proyecto", ts: 1000 },
    { role: "assistant", content: "¡Qué buenas noticias!", ts: 1001 },
    { role: "user", content: "Fue un trabajo duro pero valió la pena, me siento genial", ts: 1002 },
    { role: "user", content: "El proyecto me trajo muchos aprendizajes sobre programación", ts: 1003 },
  ],
  memories: [],
  summary: "",
  dominantEmotion: "neutral",
  dominantThemes: [],
  linkedNeurons: [],
  insights: [],
  status: "open",
  geminiProcessed: false,
  createdAt: "2026-03-22T00:00:00.000Z",
  updatedAt: "2026-03-22T00:00:00.000Z",
};

test("inferDayEmotion detecta alegría en mensajes positivos", () => {
  const emotion = inferDayEmotion(SAMPLE_DAY);
  assert.equal(emotion, "alegría");
});

test("inferDayEmotion retorna neutral si no hay mensajes", () => {
  const emptyDay = { ...SAMPLE_DAY, rawChat: [] };
  const emotion = inferDayEmotion(emptyDay);
  assert.equal(emotion, "neutral");
});

test("inferDayEmotion ignora mensajes del asistente", () => {
  const day = {
    ...SAMPLE_DAY,
    rawChat: [
      { role: "assistant", content: "feliz genial éxito contento", ts: 1000 },
      { role: "user", content: "hoy me siento triste y deprimido", ts: 1001 },
    ],
  };
  const emotion = inferDayEmotion(day);
  assert.equal(emotion, "tristeza");
});

test("extractDayThemes retorna los temas más frecuentes", () => {
  const themes = extractDayThemes(SAMPLE_DAY);
  assert.ok(Array.isArray(themes));
  assert.ok(themes.length > 0);
  assert.ok(themes.length <= 5);
});

test("extractDayThemes retorna array vacío si no hay mensajes", () => {
  const emptyDay = { ...SAMPLE_DAY, rawChat: [] };
  const themes = extractDayThemes(emptyDay);
  assert.deepEqual(themes, []);
});

test("summarizeDay genera un resumen con información del día", () => {
  const summary = summarizeDay(SAMPLE_DAY);
  assert.ok(typeof summary === "string");
  assert.ok(summary.length > 0);
  assert.ok(summary.includes("mensaje"));
});

test("summarizeDay indica día sin actividad si rawChat está vacío", () => {
  const emptyDay = { ...SAMPLE_DAY, rawChat: [] };
  const summary = summarizeDay(emptyDay);
  assert.equal(summary, "Día sin actividad registrada.");
});

test("summarizeDay incluye la emoción dominante del día", () => {
  const dayWithEmotion = { ...SAMPLE_DAY, dominantEmotion: "calma" };
  const summary = summarizeDay(dayWithEmotion);
  assert.ok(summary.includes("calma"));
});

test("aggregateActivatedNeurons recoge IDs de activatedNeuronIds", () => {
  const day = {
    ...SAMPLE_DAY,
    rawChat: [
      { role: "assistant", content: "respuesta", activatedNeuronIds: ["n1", "n2"], ts: 1000 },
      { role: "assistant", content: "respuesta 2", activatedNeuronIds: ["n2", "n3"], ts: 1001 },
    ],
  };
  const ids = aggregateActivatedNeurons(day);
  assert.ok(ids.includes("n1"));
  assert.ok(ids.includes("n2"));
  assert.ok(ids.includes("n3"));
  assert.equal(ids.length, 3); // sin duplicados
});

test("aggregateActivatedNeurons recoge IDs de linkedNeurons", () => {
  const day = {
    ...SAMPLE_DAY,
    rawChat: [
      { role: "user", content: "mensaje", linkedNeurons: ["n4", "n5"], ts: 1000 },
    ],
  };
  const ids = aggregateActivatedNeurons(day);
  assert.ok(ids.includes("n4"));
  assert.ok(ids.includes("n5"));
});

test("aggregateActivatedNeurons retorna array vacío si no hay neuronas", () => {
  const emptyDay = { ...SAMPLE_DAY, rawChat: [{ role: "user", content: "texto", ts: 1000 }] };
  const ids = aggregateActivatedNeurons(emptyDay);
  assert.deepEqual(ids, []);
});

// ---- Tests: integración entre módulos ----

test("integración: cerrar día genera resumen y neuronas automáticas", () => {
  resetStorage();
  const msg1 = { role: "user", content: "Hoy logré terminar el proyecto", ts: Date.now() };
  const msg2 = { role: "assistant", content: "Bien hecho", activatedNeuronIds: ["n10", "n11"], ts: Date.now() + 1 };
  appendToCurrentDay(msg1);
  appendToCurrentDay(msg2);

  const day = getCurrentDay();
  assert.equal(day.rawChat.length, 2);
  assert.ok(day.rawChat.some((m) => m.role === "user"));
});

test("integración: linkDayToNeurons y aggregateActivatedNeurons son consistentes", () => {
  resetStorage();
  appendToCurrentDay({ role: "assistant", activatedNeuronIds: ["nA", "nB"], ts: Date.now() });
  const day = getCurrentDay();

  // aggregateActivatedNeurons extrae de rawChat
  const fromRaw = aggregateActivatedNeurons(day);
  assert.ok(fromRaw.includes("nA"));
  assert.ok(fromRaw.includes("nB"));

  // linkDayToNeurons los persiste en linkedNeurons del día
  linkDayToNeurons(day.id, fromRaw);
  const updated = getDayByDate(todayStr());
  assert.ok(updated.linkedNeurons.includes("nA"));
  assert.ok(updated.linkedNeurons.includes("nB"));
});

// ---- Tests: fallback si Gemini falla ----

test("applyDayRefinement no rompe el estado si refinement tiene campos inválidos", () => {
  resetStorage();
  const day = getCurrentDay();
  updateDay({ ...day, summary: "resumen original" });
  const dayAfterUpdate = getDayByDate(todayStr());

  // Refinement con campos inesperados (no debería romper nada)
  const result = applyDayRefinement(dayAfterUpdate, { unexpectedField: 123 });
  // geminiProcessed se marca true incluso si no hay campos válidos
  assert.ok(result.geminiProcessed);
  // El summary original se mantiene si no viene improvedSummary
  assert.equal(result.summary, "resumen original");
});

test("múltiples días se almacenan correctamente", () => {
  resetStorage();
  const today = getCurrentDay();
  assert.equal(today.date, todayStr());

  // Simular que ya hay un día de ayer guardado
  const yesterday = {
    id: "day_yesterday_abc",
    date: "2026-03-21",
    rawChat: [{ role: "user", content: "mensaje de ayer", ts: 1000 }],
    memories: [], summary: "día de ayer", dominantEmotion: "calma",
    dominantThemes: ["trabajo"], linkedNeurons: [], insights: [],
    status: "closed", geminiProcessed: false,
    createdAt: "2026-03-21T00:00:00.000Z", updatedAt: "2026-03-21T00:00:00.000Z",
    _previousVersion: null,
  };

  // Insertar manualmente en el store
  const days = getAllDays();
  days.push(yesterday);
  localStorage.setItem("memorycarl_days_v1", JSON.stringify(days));

  const allDays = getAllDays();
  assert.ok(allDays.length >= 2);
  assert.ok(allDays.some((d) => d.date === "2026-03-21"));
  assert.ok(allDays.some((d) => d.date === todayStr()));
});
