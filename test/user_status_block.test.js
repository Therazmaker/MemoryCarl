/**
 * user_status_block.test.js — Lo que Carl ve de tu estado (datos inventados)
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildUserStatusBlock, lastSleepLine, moodTodayLine, scalesLines } from "../src/chat/userStatusBlock.js";

// Martes 24 nov 2026, 21:30 hora local (en Londres ya sería miércoles 25)
const now = new Date(2026, 10, 24, 21, 30);

test("sueño: lee totalMinutes (no 'hours'), toma la fecha más reciente y suma tramos del mismo día", () => {
  const log = [
    { date: "2026-11-24", totalMinutes: 330, quality: 2 },
    { date: "2026-11-22", totalMinutes: 480, quality: 5 },
    { date: "2026-11-24", totalMinutes: 40, quality: 4 },
  ];
  assert.equal(lastSleepLine(log, "2026-11-24"), "🌙 Último sueño registrado (hoy): 6 h 10 min, calidad 3/5");
  assert.equal(lastSleepLine([{ date: "2026-11-23", totalMinutes: 420 }], "2026-11-24"), "🌙 Último sueño registrado (ayer): 7 h");
  assert.equal(lastSleepLine([], "2026-11-24"), null);
});

test("ánimo: la lista de caras de hoy (y el formato viejo de una sola cara)", () => {
  const ts1 = new Date(2026, 10, 24, 9, 5).toISOString();
  const ts2 = new Date(2026, 10, 24, 18, 40).toISOString();
  const md = { "2026-11-24": [{ spriteId: "good", energy: 4, ts: ts1 }, { spriteId: "bad", ts: ts2 }] };
  assert.equal(moodTodayLine(md, "2026-11-24"), "😊 Ánimo hoy: bien (09:05, energía 4/5) → mal (18:40)");
  assert.equal(moodTodayLine({ "2026-11-24": { spriteId: "meh" } }, "2026-11-24"), "😊 Ánimo hoy: meh");
  assert.equal(moodTodayLine({}, "2026-11-24"), null);
});

test("bitácora: lo de hoy y el promedio de 7 días (solo con 2 o más días)", () => {
  const store = { days: {
    "2026-11-24": { stress: 8, focus: 4 },
    "2026-11-23": { stress: 6, water: 5 },
    "2026-11-10": { stress: 1 },
  } };
  assert.deepEqual(scalesLines(store, "2026-11-24"), [
    "📓 Bitácora de hoy (1–10): estrés 8, enfoque 4",
    "📓 Bitácora, promedio últimos 7 días: estrés 7",
  ]);
});

test("el bloque usa la fecha local: a las 21:30 sigue siendo el 24", () => {
  const block = buildUserStatusBlock({
    sleepLog: [{ date: "2026-11-24", totalMinutes: 360 }],
    moodDaily: { "2026-11-24": [{ spriteId: "incredible" }] },
    scales: { days: { "2026-11-24": { energy: 7 } } },
    now,
  });
  assert.match(block, /## ESTADO ACTUAL DEL USUARIO/);
  assert.match(block, /Último sueño registrado \(hoy\): 6 h/);
  assert.match(block, /Ánimo hoy: increíble/);
  assert.match(block, /Bitácora de hoy \(1–10\): energía 7/);
  assert.doesNotMatch(block, /\[object Object\]/);
});

test("sin datos no agrega nada", () => {
  assert.equal(buildUserStatusBlock({ sleepLog: [], moodDaily: {}, scales: { days: {} }, now }), "");
});
